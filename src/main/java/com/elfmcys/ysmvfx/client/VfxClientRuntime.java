package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.elfmcys.ysmvfx.asset.EffectAssetBundle;
import com.elfmcys.ysmvfx.asset.LocalVfxAssetSource;
import com.elfmcys.ysmvfx.asset.VfxAssetSource;
import com.elfmcys.ysmvfx.client.noop.UnavailableEffectBackend;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.Entity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** Client-side command and lifetime owner for complete model-plus-particle effects. */
public final class VfxClientRuntime {
    private static final Logger LOGGER = LoggerFactory.getLogger(YesSteveVfx.MOD_ID + ".client");
    private static final Map<Key, RunningEffect> ACTIVE = new ConcurrentHashMap<>();
    private static final VfxActionQueue PENDING = new VfxActionQueue();
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
        PENDING.clear();
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

    /** Molang may run while the renderer iterates world entities; capture values only. */
    public static boolean enqueuePlay(UUID sourceId, String effectId, String slot) {
        boolean accepted = sourceId != null && effectId != null && bundles.containsKey(effectId)
                && hasBackend() && PENDING.play(sourceId, effectId, slot);
        if (!accepted) {
            LOGGER.info("Rejected queued VFX play effect={} slot={} source={} loaded={} backend={} pending={}",
                    effectId, slot, sourceId, loaded, hasBackend(), PENDING.size());
        }
        return accepted;
    }

    public static boolean enqueueStop(UUID sourceId, String slot) {
        boolean accepted = sourceId != null && hasBackend()
                && PENDING.stop(sourceId, slot, VfxClientRuntime::hasActiveSlot);
        if (!accepted) {
            LOGGER.info("Rejected queued VFX stop slot={} source={} backend={} pending={}",
                    slot, sourceId, hasBackend(), PENDING.size());
        }
        return accepted;
    }

    public static boolean enqueueSet(UUID sourceId, String slot, String name, double value) {
        boolean accepted = sourceId != null && hasBackend()
                && PENDING.set(sourceId, slot, name, value, VfxClientRuntime::hasActiveSlot);
        if (!accepted) {
            LOGGER.info("Rejected queued VFX set slot={} name={} value={} source={} backend={} pending={}",
                    slot, name, value, sourceId, hasBackend(), PENDING.size());
        }
        return accepted;
    }

    private static boolean hasActiveSlot(VfxActionQueue.Key key) {
        return ACTIVE.containsKey(new Key(key.sourceId(), key.slot()));
    }

    public static int pendingActionCount() {
        return PENDING.size();
    }

    public static int activeEffectCount() {
        return ACTIVE.size();
    }

    public static boolean hasBackend() {
        return backend != UnavailableEffectBackend.INSTANCE;
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
        if (sourceId == null || !VfxActionQueue.validSlot(slot)
                || !VfxActionQueue.validParameter(name, value)) {
            return false;
        }
        RunningEffect running = ACTIVE.get(new Key(sourceId, slot));
        return running != null && backend.set(running.handle(), name, value);
    }

    public static void tick(ClientLevel level) {
        // Preserve source order, including play -> set -> stop in one instruction frame.
        // Never retain YSM entities, execution contexts or AST nodes in this queue.
        for (VfxActionQueue.Action action : PENDING.drain()) {
            var key = action.key();
            try {
                boolean applied;
                if (action instanceof VfxActionQueue.Play play) {
                    applied = play(key.sourceId(), play.effectId(), key.slot());
                } else if (action instanceof VfxActionQueue.Stop) {
                    applied = stop(key.sourceId(), key.slot());
                } else {
                    var set = (VfxActionQueue.SetParameter) action;
                    applied = set(key.sourceId(), key.slot(), set.name(), set.value());
                }
                if (!applied) {
                    LOGGER.info("Queued VFX action could not be applied: {} (world={}, loaded={}, bundles={}, backend={})",
                            action, level, loaded, bundles.size(), hasBackend());
                } else {
                    LOGGER.info("Applied queued VFX action: {}", action);
                }
            } catch (RuntimeException | LinkageError exception) {
                LOGGER.error("Could not apply queued VFX action {}", action, exception);
            }
        }
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
        PENDING.clear();
        for (RunningEffect running : ACTIVE.values()) {
            backend.stop(running.handle());
        }
        ACTIVE.clear();
        backend.clear();
    }

    public static void unload() {
        PENDING.clear();
        backend.unload();
        ACTIVE.clear();
        bundles = Map.of();
        loaded = false;
    }

    private static Entity findEntity(ClientLevel level, UUID id) {
        // The local player is not guaranteed to be present in the renderer's
        // iterable (first-person and culling paths can omit it), but it is
        // always part of the client player list.
        for (var player : level.players()) {
            if (id.equals(player.getUUID())) {
                return player;
            }
        }
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
