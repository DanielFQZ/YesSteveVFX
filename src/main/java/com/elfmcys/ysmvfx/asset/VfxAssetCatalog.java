package com.elfmcys.ysmvfx.asset;
import java.util.Map;
public record VfxAssetCatalog(Map<String, EffectAssetBundle> effects, Map<String, PackAssets> packs) {
    public VfxAssetCatalog { effects = Map.copyOf(effects); packs = Map.copyOf(packs); }
}
