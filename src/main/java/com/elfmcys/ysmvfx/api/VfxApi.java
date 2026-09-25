package com.elfmcys.ysmvfx.api;

import java.util.UUID;

/** Direct client-side integration point for other mods. */
public final class VfxApi {
    private VfxApi() {
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
