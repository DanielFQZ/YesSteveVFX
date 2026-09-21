package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RenderLevelStageEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.joml.Matrix4f;

/**
 * First visual implementation: a virtual blue/cyan scene and an animated rim.
 * The plane is depth-writing, so ordinary entities (including YSM-rendered
 * entities) naturally appear in front of the hole when they are closer to the
 * camera than the portal plane.
 */
@Mod.EventBusSubscriber(modid = YesSteveVfx.MOD_ID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class PortalRenderer {
    private static final int SEGMENTS = 64;
    private static final float SURFACE_EPSILON = 0.0125f;

    private PortalRenderer() {
    }

    @SubscribeEvent
    public static void render(RenderLevelStageEvent event) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_SOLID_BLOCKS) {
            return;
        }

        Minecraft minecraft = Minecraft.getInstance();
        ClientLevel level = minecraft.level;
        if (level == null) {
            return;
        }

        for (PortalDefinition portal : ClientPortalManager.visibleIn(level)) {
            renderFill(event.getPoseStack(), event.getCamera().getPosition(), portal);
        }
    }

    @SubscribeEvent
    public static void renderRim(RenderLevelStageEvent event) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_PARTICLES) {
            return;
        }

        Minecraft minecraft = Minecraft.getInstance();
        ClientLevel level = minecraft.level;
        if (level == null) {
            return;
        }

        float partialTick = event.getPartialTick();
        long time = level.getGameTime();
        for (PortalDefinition portal : ClientPortalManager.visibleIn(level)) {
            renderRim(event.getPoseStack(), event.getCamera().getPosition(), portal,
                    (time + partialTick) * 0.08f);
        }
    }

    private static void renderFill(PoseStack poseStack, Vec3 cameraPosition, PortalDefinition portal) {
        Matrix4f pose = poseStack.last().pose();
        PortalRenderTypes.FILL.setupRenderState();
        try {
            Vec3 origin = new Vec3(portal.x(), portal.y() + SURFACE_EPSILON, portal.z()).subtract(cameraPosition);
            BufferBuilder buffer = Tesselator.getInstance().getBuilder();
            buffer.begin(VertexFormat.Mode.TRIANGLE_FAN, com.mojang.blaze3d.vertex.DefaultVertexFormat.POSITION_COLOR);

            int center = 0xE532DFF0;
            buffer.vertex(pose, (float) origin.x, (float) origin.y, (float) origin.z)
                    .color(center)
                    .endVertex();

            for (int i = 0; i <= SEGMENTS; i++) {
                double angle = i * Math.PI * 2.0 / SEGMENTS;
                float x = (float) (origin.x + Math.cos(angle) * portal.radiusX());
                float z = (float) (origin.z + Math.sin(angle) * portal.radiusZ());
                int edge = 0xC828A7D8;
                buffer.vertex(pose, x, (float) origin.y, z)
                        .color(edge)
                        .endVertex();
            }

            BufferUploader.drawWithShader(buffer.end());
        } finally {
            PortalRenderTypes.FILL.clearRenderState();
        }
    }

    private static void renderRim(PoseStack poseStack, Vec3 cameraPosition, PortalDefinition portal, float pulse) {
        Matrix4f pose = poseStack.last().pose();
        PortalRenderTypes.RIM.setupRenderState();
        try {
            Vec3 origin = new Vec3(portal.x(), portal.y() + SURFACE_EPSILON * 1.5f, portal.z()).subtract(cameraPosition);
            BufferBuilder buffer = Tesselator.getInstance().getBuilder();
            buffer.begin(VertexFormat.Mode.TRIANGLE_STRIP, com.mojang.blaze3d.vertex.DefaultVertexFormat.POSITION_COLOR);

            float breathing = 1.0f + (float) Math.sin(pulse) * 0.025f;
            float innerX = portal.radiusX() * breathing;
            float innerZ = portal.radiusZ() * breathing;
            float outerX = innerX + 0.20f;
            float outerZ = innerZ + 0.20f;

            for (int i = 0; i <= SEGMENTS; i++) {
                double angle = i * Math.PI * 2.0 / SEGMENTS;
                float cos = (float) Math.cos(angle);
                float sin = (float) Math.sin(angle);

                int outerColor = rimColor(i, 220);
                buffer.vertex(pose, (float) origin.x + cos * outerX, (float) origin.y, (float) origin.z + sin * outerZ)
                        .color(outerColor)
                        .endVertex();
                buffer.vertex(pose, (float) origin.x + cos * innerX, (float) origin.y, (float) origin.z + sin * innerZ)
                        .color(rimColor(i, 245))
                        .endVertex();
            }

            BufferUploader.drawWithShader(buffer.end());
        } finally {
            PortalRenderTypes.RIM.clearRenderState();
        }
    }

    private static int rimColor(int index, int alpha) {
        float wave = 0.75f + 0.25f * (float) Math.sin(index * 0.7f);
        int red = (int) (255 * wave);
        int green = (int) (125 + 80 * wave);
        int blue = 35;
        return (alpha << 24) | (red << 16) | (green << 8) | blue;
    }
}
