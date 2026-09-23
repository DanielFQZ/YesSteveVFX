package com.elfmcys.ysmvfx.asset;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Loads config/yesstevevfx/packs directories without publishing partial reloads. */
public final class LocalVfxAssetSource implements VfxAssetSource {
    private static final int MAX_PACKS = 256;
    private static final int MAX_FILES_PER_PACK = 4_096;
    private static final int MAX_ENTRIES_PER_PACK = 8_192;
    private static final int MAX_EFFECTS = 4_096;
    private static final int MAX_FILE_BYTES = 16 * 1024 * 1024;
    private static final int MAX_JSON_BYTES = 1024 * 1024;
    private static final long MAX_PACK_BYTES = 128L * 1024 * 1024;
    private static final long MAX_SNAPSHOT_BYTES = 256L * 1024 * 1024;
    private final Path packsDirectory;

    public LocalVfxAssetSource(Path packsDirectory) {
        this.packsDirectory = Objects.requireNonNull(packsDirectory, "packsDirectory").toAbsolutePath().normalize();
    }

    @Override
    public Map<String, EffectAssetBundle> load() throws IOException {
        if (Files.isSymbolicLink(packsDirectory)) {
            throw invalid(packsDirectory, "links and paths outside the VFX root are not allowed");
        }
        if (!Files.exists(packsDirectory, LinkOption.NOFOLLOW_LINKS)) {
            return Map.of();
        }
        requireDirectory(packsDirectory);
        List<Path> packs;
        try (var stream = Files.list(packsDirectory)) {
            packs = stream.sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .limit(MAX_PACKS + 1L).toList();
        }
        if (packs.size() > MAX_PACKS) {
            throw invalid(packsDirectory, "too many packs (maximum " + MAX_PACKS + ")");
        }

        Map<String, EffectAssetBundle> effects = new LinkedHashMap<>();
        Set<String> packIds = new HashSet<>();
        long snapshotBytes = 0;
        for (Path pack : packs) {
            requireDirectory(pack);
            Map<String, byte[]> files = readPack(pack);
            for (byte[] bytes : files.values()) {
                snapshotBytes += bytes.length;
            }
            if (snapshotBytes > MAX_SNAPSHOT_BYTES) {
                throw invalid(pack, "combined packs exceed the resource byte budget");
            }
            JsonObject manifest = readObject(files, "manifest.json", pack);
            checkFields(manifest, Set.of("format_version", "pack_id", "display_name", "effects"), pack);
            requireVersion(manifest, pack);
            String packId = string(manifest, "pack_id", pack);
            if (!packId.matches("[a-z0-9][a-z0-9._-]{0,63}")) {
                throw invalid(pack, "invalid pack_id: " + packId);
            }
            if (!packIds.add(packId)) {
                throw invalid(pack, "duplicate pack_id: " + packId);
            }
            if (manifest.has("display_name")) {
                string(manifest, "display_name", pack);
            }
            JsonElement entries = manifest.get("effects");
            if (entries == null || !entries.isJsonArray() || entries.getAsJsonArray().isEmpty()) {
                throw invalid(pack, "effects must be a non-empty array of relative effect.json paths");
            }
            Set<String> effectPaths = new HashSet<>();
            for (JsonElement entry : entries.getAsJsonArray()) {
                if (!entry.isJsonPrimitive() || !entry.getAsJsonPrimitive().isString()) {
                    throw invalid(pack, "effects entries must be strings");
                }
                String effectPath = entry.getAsString();
                checkPath(effectPath, pack);
                if (!effectPaths.add(effectPath)) {
                    throw invalid(pack, "duplicate effect manifest path: " + effectPath);
                }
                Path diagnosticPath = pack.resolve(effectPath);
                JsonObject json = readObject(files, effectPath, pack);
                checkFields(json, Set.of("format_version", "id", "duration_ticks", "client_entity"), diagnosticPath);
                requireVersion(json, diagnosticPath);
                EffectDefinition definition;
                try {
                    definition = new EffectDefinition(string(json, "id", diagnosticPath),
                            integer(json, "duration_ticks", diagnosticPath),
                            string(json, "client_entity", diagnosticPath));
                } catch (IllegalArgumentException e) {
                    throw invalid(diagnosticPath, e.getMessage());
                }
                if (!files.containsKey(definition.clientEntity())) {
                    throw invalid(diagnosticPath, "missing client_entity: " + definition.clientEntity());
                }
                if (!definition.clientEntity().startsWith("assets/eyelib/entity/")
                        || !definition.clientEntity().endsWith(".json")) {
                    throw invalid(diagnosticPath, "client_entity must be an assets/eyelib/entity/*.json resource");
                }
                if (effects.containsKey(definition.id())) {
                    throw invalid(diagnosticPath, "duplicate effect id: " + definition.id());
                }
                if (effects.size() >= MAX_EFFECTS) {
                    throw invalid(diagnosticPath, "too many effects (maximum " + MAX_EFFECTS + ")");
                }
                effects.put(definition.id(), new EffectAssetBundle(definition, files));
            }
        }
        return Collections.unmodifiableMap(effects);
    }

    private static Map<String, byte[]> readPack(Path pack) throws IOException {
        Path realPack = pack.toRealPath();
        List<Path> entries;
        try (var walk = Files.walk(pack)) {
            entries = walk.limit(MAX_ENTRIES_PER_PACK + 1L).sorted().toList();
        }
        if (entries.size() > MAX_ENTRIES_PER_PACK) {
            throw invalid(pack, "too many directory entries");
        }
        Map<String, byte[]> files = new LinkedHashMap<>();
        long total = 0;
        for (Path path : entries) {
            if (Files.isSymbolicLink(path) || !path.toRealPath().startsWith(realPack)) {
                throw invalid(path, "links and paths outside the pack are not allowed");
            }
            if (Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
                continue;
            }
            if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
                throw invalid(path, "only regular files are supported");
            }
            if (files.size() >= MAX_FILES_PER_PACK) {
                throw invalid(pack, "too many resource files");
            }
            String relative = pack.relativize(path).toString().replace('\\', '/');
            checkPath(relative, pack);
            if (Files.size(path) > MAX_FILE_BYTES) {
                throw invalid(path, "file exceeds " + MAX_FILE_BYTES + " bytes");
            }
            byte[] bytes;
            try (InputStream input = Files.newInputStream(path)) {
                bytes = input.readNBytes(MAX_FILE_BYTES + 1);
            }
            if (bytes.length > MAX_FILE_BYTES) {
                throw invalid(path, "file exceeds " + MAX_FILE_BYTES + " bytes");
            }
            total += bytes.length;
            if (total > MAX_PACK_BYTES) {
                throw invalid(pack, "pack exceeds the resource byte budget");
            }
            files.put(relative, bytes);
        }
        return Collections.unmodifiableMap(files);
    }

    private static JsonObject readObject(Map<String, byte[]> files, String relative, Path pack) throws IOException {
        checkPath(relative, pack);
        Path diagnosticPath = pack.resolve(relative);
        byte[] bytes = files.get(relative);
        if (bytes == null) {
            throw invalid(diagnosticPath, "required file is missing");
        }
        if (bytes.length > MAX_JSON_BYTES) {
            throw invalid(diagnosticPath, "metadata JSON exceeds " + MAX_JSON_BYTES + " bytes");
        }
        try {
            JsonElement parsed = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8));
            if (!parsed.isJsonObject()) {
                throw invalid(diagnosticPath, "expected a JSON object");
            }
            return parsed.getAsJsonObject();
        } catch (JsonParseException e) {
            throw new IOException(diagnosticPath + ": invalid JSON", e);
        }
    }

    private static void requireVersion(JsonObject json, Path path) throws IOException {
        if (integer(json, "format_version", path) != 1) {
            throw invalid(path, "unsupported format_version (expected 1)");
        }
    }

    private static void checkFields(JsonObject object, Set<String> allowed, Path path) throws IOException {
        for (String key : object.keySet()) {
            if (!allowed.contains(key)) {
                throw invalid(path, "unknown field: " + key);
            }
        }
    }

    private static String string(JsonObject object, String key, Path path) throws IOException {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()
                || value.getAsString().isBlank() || value.getAsString().length() > 512) {
            throw invalid(path, key + " must be a non-empty string of at most 512 characters");
        }
        return value.getAsString();
    }

    private static int integer(JsonObject object, String key, Path path) throws IOException {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw invalid(path, key + " must be an integer");
        }
        try {
            return value.getAsBigDecimal().intValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            throw invalid(path, key + " must be an integer");
        }
    }

    static void validateRelativePath(String path) {
        Objects.requireNonNull(path, "path");
        if (path.isBlank() || path.length() > 512 || path.indexOf('\\') >= 0 || path.indexOf(':') >= 0) {
            throw new IllegalArgumentException("Resource path must be a relative slash-separated path");
        }
        for (int i = 0; i < path.length(); i++) {
            if (Character.isISOControl(path.charAt(i))) {
                throw new IllegalArgumentException("Resource path contains control characters");
            }
        }
        for (String segment : path.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                throw new IllegalArgumentException("Resource path cannot be absolute or contain empty, . or .. segments");
            }
        }
    }

    private static void checkPath(String path, Path owner) throws IOException {
        try {
            validateRelativePath(path);
        } catch (IllegalArgumentException e) {
            throw invalid(owner, e.getMessage() + ": " + path);
        }
    }

    private static void requireDirectory(Path path) throws IOException {
        if (Files.isSymbolicLink(path) || !Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS)) {
            throw invalid(path, "expected a directory, not a link or file");
        }
    }

    private static IOException invalid(Path path, String detail) {
        return new IOException(path + ": " + detail);
    }
}
