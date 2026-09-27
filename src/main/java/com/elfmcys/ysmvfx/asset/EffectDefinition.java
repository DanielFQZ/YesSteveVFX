package com.elfmcys.ysmvfx.asset;

import java.util.Objects;

/** Shared effect metadata. Resource paths are relative to the containing pack. */
public record EffectDefinition(String id, int durationTicks, String clientEntity) {
    public static final int MAX_DURATION_TICKS = 72_000;

    public EffectDefinition {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(clientEntity, "clientEntity");
        if (!validId(id)) {
            throw new IllegalArgumentException("Effect id must be a namespace:path resource identifier");
        }
        if (durationTicks < 1 || durationTicks > MAX_DURATION_TICKS) {
            throw new IllegalArgumentException("Effect duration must be between 1 and " + MAX_DURATION_TICKS + " ticks");
        }
        LocalVfxAssetSource.validateRelativePath(clientEntity);
    }

    private static boolean validId(String id) {
        if (id.length() > 256) return false;
        int colon = id.indexOf(':');
        if (colon <= 0 || colon != id.lastIndexOf(':') || colon == id.length() - 1) return false;
        String namespace = id.substring(0, colon);
        String path = id.substring(colon + 1);
        if (!namespace.matches("[a-z0-9_.-]+") || !path.matches("[a-z0-9_./-]+")) return false;
        for (String segment : path.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return false;
        }
        return true;
    }
}
