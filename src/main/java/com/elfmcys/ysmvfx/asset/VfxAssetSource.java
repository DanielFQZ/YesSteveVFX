package com.elfmcys.ysmvfx.asset;

import java.io.IOException;
import java.util.Map;

/** Provides a complete, validated snapshot, whether from local files or a future YSM container. */
@FunctionalInterface
public interface VfxAssetSource {
    Map<String, EffectAssetBundle> load() throws IOException;
}
