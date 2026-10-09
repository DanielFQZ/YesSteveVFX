package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.asset.EffectAssetBundle;
import net.minecraft.client.multiplayer.ClientLevel;
import org.jetbrains.annotations.Nullable;

import java.util.Map;
import java.util.List;
import net.minecraft.world.phys.AABB;

/** Rendering backend boundary; the default build can run without eyelib. */
public interface EffectBackend {
    void reload(Map<String, EffectAssetBundle> bundles) throws Exception;

    @Nullable
    EffectHandle play(EffectPlayRequest request, EffectAssetBundle bundle,
                      CarrierFactory carrierFactory, ClientLevel level) throws Exception;

    boolean stop(EffectHandle handle);

    boolean set(EffectHandle handle, String name, double value);

    /** Updates the carrier root transform; backends may ignore it for world-fixed effects. */
    default void update(EffectHandle handle, EffectPlayRequest request) {
    }

    /** World-space collision boxes exported by the current animated model. */
    default List<AABB> hitBoxes(EffectHandle handle) {
        return List.of();
    }

    void clear();

    /** Releases live instances and backend-owned published resources. */
    default void unload() {
        clear();
    }

    void tick(ClientLevel level);
}
