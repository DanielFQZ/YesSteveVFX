package com.elfmcys.ysmvfx.asset;

import java.io.IOException;
import java.util.*;

/** One immutable snapshot shared by every effect and sound in a pack. */
public final class PackAssets {
    private final Map<String, byte[]> files;
    public PackAssets(Map<String, byte[]> source) {
        var copy = new LinkedHashMap<String, byte[]>();
        source.forEach((path, bytes) -> {
            LocalVfxAssetSource.validateRelativePath(path);
            copy.put(path, bytes.clone());
        });
        files = Collections.unmodifiableMap(copy);
    }
    public Set<String> paths() { return files.keySet(); }
    public byte[] read(String path) throws IOException {
        byte[] bytes = files.get(path);
        if (bytes == null) throw new IOException("Missing VFX resource: " + path);
        return bytes.clone();
    }
    public Map<String, byte[]> files() {
        var copy = new LinkedHashMap<String, byte[]>();
        files.forEach((p, b) -> copy.put(p, b.clone()));
        return Collections.unmodifiableMap(copy);
    }
}
