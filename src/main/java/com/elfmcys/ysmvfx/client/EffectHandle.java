package com.elfmcys.ysmvfx.client;

import net.minecraft.world.entity.LivingEntity;

/** Runtime-owned handle for one effect slot. */
public interface EffectHandle {
    LivingEntity carrier();
}
