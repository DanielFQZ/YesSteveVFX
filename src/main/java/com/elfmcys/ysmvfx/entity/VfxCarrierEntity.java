package com.elfmcys.ysmvfx.entity;

import com.elfmcys.ysmvfx.YesSteveVfx;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.decoration.ArmorStand;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/** Marker armor-stand carrier; eyelib supplies the visible model through RenderData. */
public final class VfxCarrierEntity extends ArmorStand {
    public static final DeferredRegister<EntityType<?>> TYPES =
            DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, YesSteveVfx.MOD_ID);
    public static final RegistryObject<EntityType<VfxCarrierEntity>> TYPE = TYPES.register(
            "vfx_carrier",
            () -> EntityType.Builder.of(VfxCarrierEntity::new, net.minecraft.world.entity.MobCategory.MISC)
                    .sized(0.01F, 0.01F)
                    .clientTrackingRange(32)
                    .updateInterval(1)
                    .build(YesSteveVfx.MOD_ID + ":vfx_carrier"));

    public VfxCarrierEntity(EntityType<? extends ArmorStand> type, Level level) {
        super(type, level);
        setNoGravity(true);
        setInvulnerable(true);
        noPhysics = true;
    }

    @Override
    public void tick() {
        super.tick();
        setDeltaMovement(0.0, 0.0, 0.0);
    }

    @Override
    public boolean isPickable() {
        return false;
    }

    @Override
    public boolean canBeCollidedWith() {
        return false;
    }

    @Override
    public boolean isPushable() {
        return false;
    }

    @Override
    public boolean hurt(net.minecraft.world.damagesource.DamageSource source, float amount) {
        return false;
    }

    @Override
    public boolean isInvisibleTo(Player player) {
        // Keep the entity in the normal LivingEntity renderer path. The empty
        // fallback renderer draws nothing until the eyelib bridge takes over.
        return false;
    }
}
