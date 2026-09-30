package com.elfmcys.ysmvfx.audio;
import com.elfmcys.ysmvfx.asset.PackAssets;
public record SoundDefinition(String id, String file, float volume, float pitch, float range,
                              boolean follow, PackAssets assets) { }
