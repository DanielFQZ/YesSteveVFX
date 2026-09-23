package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.entity.VfxCarrierEntity;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.LivingEntity;

import java.util.concurrent.atomic.AtomicInteger;

/** Client-only carrier factory for eyelib's LivingEntity render entry point. */
public enum ClientCarrierFactory implements CarrierFactory {
    INSTANCE;

    private static final AtomicInteger NEXT_ID = new AtomicInteger(Integer.MIN_VALUE / 2);

    @Override
    public LivingEntity create(ClientLevel level, EffectPlayRequest request) {
        VfxCarrierEntity carrier = VfxCarrierEntity.TYPE.get().create(level);
        if (carrier == null) {
            throw new IllegalStateException("Could not create VFX carrier");
        }
        int id = NEXT_ID.getAndIncrement();
        carrier.setId(id);
        carrier.moveTo(request.position().x, request.position().y, request.position().z,
                request.yaw(), request.pitch());
        level.putNonPlayerEntity(id, carrier);
        return carrier;
    }

    @Override
    public void remove(LivingEntity carrier) {
        carrier.remove(net.minecraft.world.entity.Entity.RemovalReason.DISCARDED);
    }
}
