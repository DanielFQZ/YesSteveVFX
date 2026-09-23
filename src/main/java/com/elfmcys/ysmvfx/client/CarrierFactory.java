package com.elfmcys.ysmvfx.client;

import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.LivingEntity;

/** Creates and removes the entity host used by eyelib's entity render path. */
public interface CarrierFactory {
    LivingEntity create(ClientLevel level, EffectPlayRequest request);

    void remove(LivingEntity carrier);
}
