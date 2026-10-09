package com.elfmcys.ysmvfx.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.Entity;

import java.lang.reflect.Method;
import java.util.UUID;

/** Optional Camera target lookup. VFX remains loadable without YesSteveCamera. */
final class VfxTargetBridge {
    private static final String TARGET_SERVICE =
            "com.github.exopandora.shouldersurfing.api.target.TargetApi";
    private static Method snapshotMethod;
    private static Method entityMethod;
    private static Method assistTargetMethod;
    private static boolean initialized;

    private VfxTargetBridge() {
    }

    static TargetRef resolve(UUID ownerId) {
        if (ownerId == null || !init()) return null;
        try {
            Object snapshot = snapshotMethod.invoke(null, ownerId);
            ClientLevel level = Minecraft.getInstance().level;
            if (level == null) return null;
            UUID targetId = snapshot == null ? null : (UUID) entityMethod.invoke(snapshot);
            // Camera publishes manual locks through TargetSnapshot. During an attack-assist
            // window the target is intentionally not a manual lock, so fall back to the
            // transient combat-assist target exposed by Camera when present.
            if (targetId == null && assistTargetMethod != null) {
                Object assisted = assistTargetMethod.invoke(null);
                if (assisted instanceof Entity entity) targetId = entity.getUUID();
            }
            if (targetId == null) return null;
            Entity target = VfxClientRuntime.findEntity(level, targetId);
            return target == null || target.isRemoved() || !target.isAlive()
                    ? null : new TargetRef(targetId, target);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) {
            return null;
        }
    }

    private static synchronized boolean init() {
        if (initialized) return snapshotMethod != null;
        initialized = true;
        try {
            ClassLoader loader = VfxTargetBridge.class.getClassLoader();
            Class<?> service = Class.forName(TARGET_SERVICE, false, loader);
            snapshotMethod = service.getMethod("snapshotFor", UUID.class);
            Class<?> snapshot = Class.forName(
                    "com.github.exopandora.shouldersurfing.api.target.TargetSnapshot", false, loader);
            entityMethod = snapshot.getMethod("entityUuid");
            try {
                Class<?> assist = Class.forName(
                        "com.github.exopandora.shouldersurfing.camera.assist.CombatAssistService", false, loader);
                assistTargetMethod = assist.getMethod("target");
            } catch (ReflectiveOperationException | LinkageError ignored) {
                // Camera versions without attack-assist support still provide manual targets.
                assistTargetMethod = null;
            }
            return true;
        } catch (ReflectiveOperationException | LinkageError ignored) {
            snapshotMethod = null;
            return false;
        }
    }

    record TargetRef(UUID entityId, Entity entity) {
    }
}
