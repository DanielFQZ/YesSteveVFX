package com.elfmcys.ysmvfx.client.noop;

import com.elfmcys.ysmvfx.asset.EffectAssetBundle;
import com.elfmcys.ysmvfx.client.CarrierFactory;
import com.elfmcys.ysmvfx.client.EffectBackend;
import com.elfmcys.ysmvfx.client.EffectHandle;
import com.elfmcys.ysmvfx.client.EffectPlayRequest;
import net.minecraft.client.multiplayer.ClientLevel;

import java.util.Map;

/** Used when the optional eyelib bridge is not installed. */
public final class UnavailableEffectBackend implements EffectBackend {
    public static final UnavailableEffectBackend INSTANCE = new UnavailableEffectBackend();

    private UnavailableEffectBackend() {
    }

    @Override
    public void reload(Map<String, EffectAssetBundle> bundles) {
    }

    @Override
    public EffectHandle play(EffectPlayRequest request, EffectAssetBundle bundle,
                             CarrierFactory carrierFactory, ClientLevel level) {
        return null;
    }

    @Override
    public boolean stop(EffectHandle handle) {
        return false;
    }

    @Override
    public boolean set(EffectHandle handle, String name, double value) {
        return false;
    }

    @Override
    public void clear() {
    }

    @Override
    public void tick(ClientLevel level) {
    }
}
