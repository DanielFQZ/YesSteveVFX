package com.elfmcys.ysmvfx.api;

import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.elfmcys.ysmvfx.server.ServerPortalManager;
import net.minecraft.server.level.ServerLevel;

import java.util.UUID;

/**
 * Optional direct integration point for other mods. Commands remain the
 * lowest-common-denominator interface; this avoids command-string parsing when
 * both mods are present in the same JVM.
 */
public final class VfxApi {
    private VfxApi() {
    }

    public static PortalDefinition permanentPortal(ServerLevel level, String id,
                                                   double x, double y, double z,
                                                   float radiusX, float radiusZ,
                                                   float virtualDepth) {
        return portal(level, id, x, y, z, radiusX, radiusZ, virtualDepth, -1);
    }

    public static PortalDefinition timedPortal(ServerLevel level, String id,
                                               double x, double y, double z,
                                               float radiusX, float radiusZ,
                                               float virtualDepth, int durationTicks) {
        if (durationTicks <= 0) {
            throw new IllegalArgumentException("Portal duration must be positive");
        }
        return portal(level, id, x, y, z, radiusX, radiusZ, virtualDepth, durationTicks);
    }

    private static PortalDefinition portal(ServerLevel level, String id,
                                           double x, double y, double z,
                                           float radiusX, float radiusZ,
                                           float virtualDepth, int duration) {
        return new PortalDefinition(
                id,
                level.dimension().location(),
                x, y, z,
                radiusX, radiusZ, virtualDepth,
                level.getGameTime(),
                duration
        );
    }

    public static void start(PortalDefinition definition) {
        ServerPortalManager.start(definition);
    }

    public static void stop(String id) {
        ServerPortalManager.stop(id);
    }

    public static void clear() {
        ServerPortalManager.clear();
    }

    /** Starts a client-local effect for one YSM entity and slot. */
    public static boolean play(UUID sourceEntity, String effectId, String slot) {
        return invokeClient("play", new Class<?>[]{UUID.class, String.class, String.class},
                sourceEntity, effectId, slot);
    }

    /** Stops the effect owned by one YSM entity and slot. */
    public static boolean stop(UUID sourceEntity, String slot) {
        return invokeClient("stop", new Class<?>[]{UUID.class, String.class}, sourceEntity, slot);
    }

    /** Updates a finite numeric parameter on one running effect. */
    public static boolean set(UUID sourceEntity, String slot, String name, double value) {
        return invokeClient("set", new Class<?>[]{UUID.class, String.class, String.class, double.class},
                sourceEntity, slot, name, value);
    }

    private static boolean invokeClient(String method, Class<?>[] types, Object... arguments) {
        try {
            Class<?> runtime = Class.forName("com.elfmcys.ysmvfx.client.VfxClientRuntime", false,
                    VfxApi.class.getClassLoader());
            Object result = runtime.getMethod(method, types).invoke(null, arguments);
            return result instanceof Boolean value && value;
        } catch (ReflectiveOperationException | LinkageError ignored) {
            return false;
        }
    }
}
