package com.elfmcys.ysmvfx;

import com.elfmcys.ysmvfx.entity.VfxCarrierEntity;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import com.elfmcys.ysmvfx.compat.yss.YssHitBridge;
import com.elfmcys.ysmvfx.network.VfxNetwork;

/**
 * Small, visual-only effects framework. Gameplay, teleportation and entity
 * movement intentionally stay outside this mod.
 */
@Mod(YesSteveVfx.MOD_ID)
public final class YesSteveVfx {
    public static final String MOD_ID = "yesstevevfx";

    public YesSteveVfx() {
        VfxCarrierEntity.TYPES.register(FMLJavaModLoadingContext.get().getModEventBus());
        VfxNetwork.init();
        FMLJavaModLoadingContext.get().getModEventBus().addListener(
                (net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent event) -> event.enqueueWork(YssHitBridge::install));
    }
}
