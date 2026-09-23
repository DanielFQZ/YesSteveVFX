package com.elfmcys.ysmvfx.client;

import net.minecraft.world.phys.Vec3;

import java.util.Objects;
import java.util.UUID;

/** Immutable input captured from one accepted play command. */
public record EffectPlayRequest(
        UUID sourceId,
        String slot,
        Vec3 position,
        float yaw,
        float pitch,
        long clientTick
) {
    public EffectPlayRequest {
        Objects.requireNonNull(sourceId, "sourceId");
        Objects.requireNonNull(slot, "slot");
        Objects.requireNonNull(position, "position");
        if (slot.isBlank() || slot.length() > 64) {
            throw new IllegalArgumentException("Effect slot must be 1-64 characters");
        }
        if (!Double.isFinite(position.x) || !Double.isFinite(position.y) || !Double.isFinite(position.z)
                || !Float.isFinite(yaw) || !Float.isFinite(pitch)) {
            throw new IllegalArgumentException("Effect transform must be finite");
        }
    }
}
