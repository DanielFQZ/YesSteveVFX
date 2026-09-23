package com.elfmcys.ysmvfx.asset;

import java.io.IOException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Immutable bytes for one effect's pack; publication never depends on mutable files on disk. */
public final class EffectAssetBundle {
    private final EffectDefinition definition;
    private final Map<String, byte[]> files;

    public EffectAssetBundle(EffectDefinition definition, Map<String, byte[]> files) {
        this.definition = Objects.requireNonNull(definition, "definition");
        Objects.requireNonNull(files, "files");
        this.files = copyFiles(files);
        if (!this.files.containsKey(definition.clientEntity())) {
            throw new IllegalArgumentException("Missing client entity resource: " + definition.clientEntity());
        }
    }

    public EffectDefinition definition() {
        return definition;
    }

    /** Returns defensive copies, including each byte array. */
    public Map<String, byte[]> files() {
        return copyFiles(files);
    }

    public Set<String> paths() {
        return files.keySet();
    }

    public byte[] read(String path) throws IOException {
        byte[] bytes = files.get(path);
        if (bytes == null) {
            throw new IOException("Missing VFX resource: " + path);
        }
        return bytes.clone();
    }

    private static Map<String, byte[]> copyFiles(Map<String, byte[]> files) {
        Map<String, byte[]> copy = new LinkedHashMap<>();
        files.forEach((path, bytes) -> {
            LocalVfxAssetSource.validateRelativePath(path);
            copy.put(path, Objects.requireNonNull(bytes, "bytes").clone());
        });
        return Collections.unmodifiableMap(copy);
    }
}
