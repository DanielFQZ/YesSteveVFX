package com.elfmcys.ysmvfx.asset;

import java.util.Objects;

/** Shared effect metadata. Resource paths are relative to the containing pack. */
public record EffectDefinition(String id, int durationTicks, String clientEntity) {
    public static final int MAX_DURATION_TICKS = 72_000;

    public EffectDefinition {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(clientEntity, "clientEntity");
        if (id.length() > 256 || !id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) {
            throw new IllegalArgumentException("Effect id must be a namespace:path resource identifier");
        }
        if (durationTicks < 1 || durationTicks > MAX_DURATION_TICKS) {
            throw new IllegalArgumentException("Effect duration must be between 1 and " + MAX_DURATION_TICKS + " ticks");
        }
        LocalVfxAssetSource.validateRelativePath(clientEntity);
    }
}
