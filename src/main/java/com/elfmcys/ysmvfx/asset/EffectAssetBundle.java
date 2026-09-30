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
    private final PackAssets assets;
    public EffectAssetBundle(EffectDefinition definition, Map<String, byte[]> files) {
        this(definition, new PackAssets(files));
    }
    public EffectAssetBundle(EffectDefinition definition, PackAssets assets) {
        this.definition = Objects.requireNonNull(definition);
        this.assets = Objects.requireNonNull(assets);
        if (!assets.paths().contains(definition.clientEntity()))
            throw new IllegalArgumentException("Missing client entity resource: " + definition.clientEntity());
    }
    public EffectDefinition definition() { return definition; }
    public Map<String, byte[]> files() { return assets.files(); }
    public Set<String> paths() { return assets.paths(); }
    public byte[] read(String path) throws IOException { return assets.read(path); }
}
