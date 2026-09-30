package com.elfmcys.ysmvfx.audio;

import com.elfmcys.ysmvfx.asset.*;
import com.google.gson.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Pure metadata parser: decoding and Minecraft publication occur separately. */
public record AudioCatalog(Map<String, SoundDefinition> sounds, Map<HitKey, String> hits) {
    public static final AudioCatalog EMPTY = new AudioCatalog(Map.of(), Map.of());
    public record HitKey(String modelId, String animation, int segmentIndex) { }
    public AudioCatalog { sounds = Map.copyOf(sounds); hits = Map.copyOf(hits); }
    public static AudioCatalog parse(VfxAssetCatalog catalog) throws IOException {
        var sounds = new LinkedHashMap<String, SoundDefinition>();
        var hits = new LinkedHashMap<HitKey, String>();
        for (var pack : catalog.packs().entrySet()) {
            PackAssets assets = pack.getValue();
            if (!assets.paths().contains("audio.json")) continue;
            try {
                byte[] metadata = assets.read("audio.json");
                if (metadata.length > 1024 * 1024) throw new IllegalArgumentException("audio.json exceeds 1 MiB");
                JsonObject root = JsonParser.parseString(new String(metadata, StandardCharsets.UTF_8)).getAsJsonObject();
                fields(root, "format_version", "sounds", "hit_bindings");
                if (number(root, "format_version", -1, 1, 1) != 1) throw new IllegalArgumentException("Unsupported audio version");
                JsonObject definitions = root.getAsJsonObject("sounds");
                if (definitions == null) throw new IllegalArgumentException("Missing sounds object");
                Set<String> local = new HashSet<>();
                for (var entry : definitions.entrySet()) {
                    String id = entry.getKey();
                    if (!id.matches("yesstevevfx:[a-z0-9_./-]+") || id.contains("..") || id.contains("//")
                            || id.endsWith("/") || id.startsWith("yesstevevfx:/")) throw new IllegalArgumentException("Invalid sound ID: " + id);
                    JsonObject obj = entry.getValue().getAsJsonObject();
                    fields(obj, "file", "volume", "pitch", "range", "follow");
                    String file = string(obj, "file");
                    LocalVfxAssetSource.validateRelativePath(file);
                    if (!file.startsWith("assets/yesstevevfx/sounds/") || !file.endsWith(".ogg"))
                        throw new IllegalArgumentException(id + ": expected assets/yesstevevfx/sounds/*.ogg");
                    int length = assets.read(file).length;
                    if (length == 0 || length > 4 * 1024 * 1024) throw new IllegalArgumentException(file + ": maximum 4 MiB");
                    boolean follow = false;
                    if (obj.has("follow")) {
                        if (!obj.get("follow").isJsonPrimitive() || !obj.getAsJsonPrimitive("follow").isBoolean())
                            throw new IllegalArgumentException("follow must be boolean");
                        follow = obj.get("follow").getAsBoolean();
                    }
                    var def = new SoundDefinition(id, file, number(obj,"volume",1,0,1), number(obj,"pitch",1,.5f,2),
                            number(obj,"range",24,1,64), follow, assets);
                    if (sounds.putIfAbsent(id, def) != null) throw new IllegalArgumentException("Duplicate sound ID: " + id);
                    if (sounds.size() > 1024) throw new IllegalArgumentException("Maximum 1024 sounds");
                    local.add(id);
                }
                if (root.has("hit_bindings")) for (var item : root.getAsJsonArray("hit_bindings")) {
                    JsonObject obj = item.getAsJsonObject(); fields(obj,"model_id","animation","segment_index","sound");
                    float segment = number(obj,"segment_index",-1,0,65535);
                    if (segment != (int) segment) throw new IllegalArgumentException("segment_index must be an integer");
                    var key = new HitKey(string(obj,"model_id"), string(obj,"animation"), (int) segment);
                    String sound = string(obj,"sound");
                    if (!local.contains(sound)) throw new IllegalArgumentException("Hit binding must reference a sound in this pack: " + sound);
                    if (hits.putIfAbsent(key,sound) != null) throw new IllegalArgumentException("Duplicate hit selector: " + key);
                    if (hits.size() > 4096) throw new IllegalArgumentException("Maximum 4096 hit bindings");
                }
            } catch (Exception error) { throw new IOException(pack.getKey() + "/audio.json: " + error.getMessage(), error); }
        }
        return new AudioCatalog(sounds, hits);
    }
    private static String string(JsonObject obj, String key) {
        JsonElement e = obj.get(key);
        if (e == null || !e.isJsonPrimitive() || !e.getAsJsonPrimitive().isString() || e.getAsString().isBlank() || e.getAsString().length()>512)
            throw new IllegalArgumentException("Invalid string: " + key);
        return e.getAsString();
    }
    private static float number(JsonObject obj, String key, float fallback, float min, float max) {
        if (!obj.has(key)) {
            if (fallback < min || fallback > max) throw new IllegalArgumentException("Missing " + key);
            return fallback;
        }
        JsonElement e = obj.get(key);
        if (!e.isJsonPrimitive() || !e.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException("Invalid number: " + key);
        float value = e.getAsFloat();
        if (!Float.isFinite(value) || value < min || value > max) throw new IllegalArgumentException("Invalid " + key + " ("+min+".."+max+")");
        return value;
    }
    private static void fields(JsonObject obj, String... allowed) {
        Set<String> keys = Set.of(allowed);
        for (String k : obj.keySet()) if (!keys.contains(k)) throw new IllegalArgumentException("Unknown field: " + k);
    }
}
