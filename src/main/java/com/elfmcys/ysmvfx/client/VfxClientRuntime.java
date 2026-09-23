package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.elfmcys.ysmvfx.asset.EffectAssetBundle;
import com.elfmcys.ysmvfx.asset.LocalVfxAssetSource;
import com.elfmcys.ysmvfx.asset.VfxAssetSource;
import com.elfmcys.ysmvfx.client.noop.UnavailableEffectBackend;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Client-side command and lifetime owner for complete model-plus-particle effects. */
public final class VfxClientRuntime {
    private static final Logger LOGGER = LoggerFactory.getLogger(YesSteveVfx.MOD_ID + ".client");
    private static final Map<Key, RunningEffect> ACTIVE = new ConcurrentHashMap<>();
    private static volatile Map<String, EffectAssetBundle> bundles = Map.of();
    private static volatile EffectBackend backend = UnavailableEffectBackend.INSTANCE;
    private static volatile boolean loaded;

    private VfxClientRuntime() {
    }

    public static void installBackend(EffectBackend replacement) {
        if (replacement == null) {
            throw new IllegalArgumentException("Effect backend must not be null");
        }
        EffectBackend previous = backend;
        previous.unload();
        ACTIVE.clear();
        backend = replacement;
        loaded = false;
    }

    public static void reloadLocal() {
        Minecraft minecraft = Minecraft.getInstance();
        Path packs = minecraft.gameDirectory.toPath()
                .resolve("config").resolve("yesstevevfx").resolve("packs");
        reload(new LocalVfxAssetSource(packs));
    }

    /** Publishes one complete asset snapshot, allowing a future YSM container source. */
    public static void reload(VfxAssetSource source) {
        try {
            Map<String, EffectAssetBundle> next = source.load();
            backend.reload(next);
            stopAll();
            bundles = next;
            loaded = true;
            LOGGER.info("Loaded {} YesSteveVFX effect definition(s)", next.size());
        } catch (Exception exception) {
            loaded = false;
            LOGGER.error("Could not load YesSteveVFX assets; previous generation remains active", exception);
        }
    }

    public static boolean isLoaded() {
        return loaded;
    }

    public static Map<String, EffectAssetBundle> bundles() {
        return bundles;
    }

    public static boolean play(UUID sourceId, String effectId, String slot) {
        Minecraft minecraft = Minecraft.getInstance();
        ClientLevel level = minecraft.level;
        if (level == null || sourceId == null || effectId == null || slot == null) {
            return false;
        }
        EffectAssetBundle bundle = bundles.get(effectId);
        Entity source = findEntity(level, sourceId);
        if (bundle == null || source == null || source.isRemoved()) {
            return false;
        }
        EffectPlayRequest request;
        try {
            request = new EffectPlayRequest(sourceId, slot, source.position(),
                    source.getYRot(), source.getXRot(), level.getGameTime());
        } catch (IllegalArgumentException exception) {
            return false;
        }

        Key key = new Key(sourceId, slot);
        RunningEffect old = ACTIVE.remove(key);
        if (old != null) {
            backend.stop(old.handle());
        }
        try {
            EffectHandle handle = backend.play(request, bundle, ClientCarrierFactory.INSTANCE, level);
            if (handle == null) {
                return false;
            }
            ACTIVE.put(key, new RunningEffect(handle, effectId, request.clientTick(),
                    bundle.definition().durationTicks()));
            return true;
        } catch (Exception exception) {
            LOGGER.error("Could not start effect {}", effectId, exception);
            return false;
        }
    }

    public static boolean stop(UUID sourceId, String slot) {
        if (sourceId == null || slot == null) {
            return false;
        }
        RunningEffect running = ACTIVE.remove(new Key(sourceId, slot));
        return running != null && backend.stop(running.handle());
    }

    public static boolean set(UUID sourceId, String slot, String name, double value) {
        if (sourceId == null || slot == null || name == null || name.isBlank()
                || name.length() > 64 || !name.matches("[A-Za-z0-9_.-]+") || !Double.isFinite(value)) {
            return false;
        }
        RunningEffect running = ACTIVE.get(new Key(sourceId, slot));
        return running != null && backend.set(running.handle(), name, value);
    }

    public static void tick(ClientLevel level) {
        backend.tick(level);
        long now = level.getGameTime();
        for (var entry : ACTIVE.entrySet()) {
            Key key = entry.getKey();
            RunningEffect running = entry.getValue();
            Entity source = findEntity(level, key.sourceId());
            if (source == null || source.isRemoved()) {
                if (ACTIVE.remove(key, running)) {
                    backend.stop(running.handle());
                }
                continue;
            }
            EffectPlayRequest request = new EffectPlayRequest(key.sourceId(), key.slot(), source.position(),
                    source.getYRot(), source.getXRot(), now);
            backend.update(running.handle(), request);
            if (now - running.startTick() >= running.durationTicks()
                    && ACTIVE.remove(key, running)) {
                backend.stop(running.handle());
            }
        }
    }

    public static void stopAll() {
        for (RunningEffect running : ACTIVE.values()) {
            backend.stop(running.handle());
        }
        ACTIVE.clear();
        backend.clear();
    }

    public static void unload() {
        backend.unload();
        ACTIVE.clear();
        bundles = Map.of();
        loaded = false;
    }

    private static Entity findEntity(ClientLevel level, UUID id) {
        for (Entity entity : level.entitiesForRendering()) {
            if (id.equals(entity.getUUID())) {
                return entity;
            }
        }
        return null;
    }

    private record Key(UUID sourceId, String slot) {
    }

    private record RunningEffect(EffectHandle handle, String effectId,
                                 long startTick, int durationTicks) {
    }
}
