package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.elfmcys.ysmvfx.model.PortalDefinition;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.RenderLevelStageEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.joml.Matrix4f;

/**
 * Renders the portal as a depth-aware fake opening. No block or dimension is
 * changed: an opaque, unlit disk hides the terrain inside the aperture and a
 * smaller, offset disk supplies a simple parallax/depth cue. A second pass is
 * made after particles and entity shadows so the hole itself does not receive
 * the vanilla shadow overlay.
 */
@Mod.EventBusSubscriber(modid = YesSteveVfx.MOD_ID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class PortalRenderer {
    private static final int SEGMENTS = 64;
    private static final float SURFACE_EPSILON = 0.0125f;

    private PortalRenderer() {
    }

    @SubscribeEvent
    public static void render(RenderLevelStageEvent event) {
        Minecraft minecraft = Minecraft.getInstance();
        ClientLevel level = minecraft.level;
        if (level == null) {
            return;
        }

        if (event.getStage() == RenderLevelStageEvent.Stage.AFTER_SOLID_BLOCKS) {
            for (PortalDefinition portal : ClientPortalManager.visibleIn(level)) {
                renderInterior(event.getPoseStack(), event.getCamera().getPosition(), portal);
            }
        } else if (event.getStage() == RenderLevelStageEvent.Stage.AFTER_PARTICLES) {
            // Shadows are rendered before this stage. Re-drawing the opaque
            // interior at the same depth removes their dark overlay without
            // covering entities that are physically above the portal plane.
            float partialTick = event.getPartialTick();
            long time = level.getGameTime();
            for (PortalDefinition portal : ClientPortalManager.visibleIn(level)) {
                renderInterior(event.getPoseStack(), event.getCamera().getPosition(), portal);
                renderRim(event.getPoseStack(), event.getCamera().getPosition(), portal,
                        (time + partialTick) * 0.08f);
            }
        }
    }

    private static void renderInterior(PoseStack poseStack, Vec3 cameraPosition, PortalDefinition portal) {
        Matrix4f pose = poseStack.last().pose();
        PortalRenderTypes.INTERIOR.setupRenderState();
        try {
            Vec3 surface = new Vec3(portal.x(), portal.y() + SURFACE_EPSILON, portal.z())
                    .subtract(cameraPosition);

            // The outer disk hides the blocks below the opening. It is opaque
            // and unlit, so a shader's terrain lighting cannot turn it white.
            drawDisk(pose, surface, portal.radiusX(), portal.radiusZ(),
                    color(3, 9, 22), color(13, 111, 132));

            // A smaller, offset disk acts as the visible bottom of the fake
            // shaft. Moving it with the camera gives a restrained parallax cue
            // while keeping all geometry in the current world render target.
            float innerScale = clamp(0.88f - portal.virtualDepth() * 0.008f, 0.58f, 0.88f);
            float parallax = Math.min(0.75f, portal.virtualDepth() * 0.025f);
            double dx = cameraPosition.x - portal.x();
            double dz = cameraPosition.z - portal.z();
            double planarDistance = Math.sqrt(dx * dx + dz * dz);
            double directionX = planarDistance > 0.0001 ? dx / planarDistance : 0.0;
            double directionZ = planarDistance > 0.0001 ? dz / planarDistance : 0.0;
            Vec3 bottom = surface.add(directionX * parallax, SURFACE_EPSILON * 0.75,
                    directionZ * parallax);

            drawDisk(pose, bottom, portal.radiusX() * innerScale, portal.radiusZ() * innerScale,
                    color(1, 2, 9), color(5, 40, 63));
        } finally {
            PortalRenderTypes.INTERIOR.clearRenderState();
        }
    }

    private static void drawDisk(Matrix4f pose, Vec3 origin, float radiusX, float radiusZ,
                                  int centerColor, int edgeColor) {
        BufferBuilder buffer = Tesselator.getInstance().getBuilder();
        buffer.begin(VertexFormat.Mode.TRIANGLE_FAN, DefaultVertexFormat.POSITION_COLOR);

        buffer.vertex(pose, (float) origin.x, (float) origin.y, (float) origin.z)
                .color(centerColor)
                .endVertex();

        for (int i = 0; i <= SEGMENTS; i++) {
            double angle = i * Math.PI * 2.0 / SEGMENTS;
            float x = (float) (origin.x + Math.cos(angle) * radiusX);
            float z = (float) (origin.z + Math.sin(angle) * radiusZ);
            buffer.vertex(pose, x, (float) origin.y, z)
                    .color(edgeColor)
                    .endVertex();
        }

        BufferUploader.drawWithShader(buffer.end());
    }

    private static void renderRim(PoseStack poseStack, Vec3 cameraPosition, PortalDefinition portal, float pulse) {
        Matrix4f pose = poseStack.last().pose();
        PortalRenderTypes.RIM.setupRenderState();
        try {
            Vec3 origin = new Vec3(portal.x(), portal.y() + SURFACE_EPSILON * 1.5f, portal.z())
                    .subtract(cameraPosition);
            BufferBuilder buffer = Tesselator.getInstance().getBuilder();
            buffer.begin(VertexFormat.Mode.TRIANGLE_STRIP, DefaultVertexFormat.POSITION_COLOR);

            float breathing = 1.0f + (float) Math.sin(pulse) * 0.025f;
            float innerX = portal.radiusX() * breathing;
            float innerZ = portal.radiusZ() * breathing;
            float outerX = innerX + 0.20f;
            float outerZ = innerZ + 0.20f;

            for (int i = 0; i <= SEGMENTS; i++) {
                double angle = i * Math.PI * 2.0 / SEGMENTS;
                float cos = (float) Math.cos(angle);
                float sin = (float) Math.sin(angle);

                buffer.vertex(pose, (float) origin.x + cos * outerX, (float) origin.y,
                                (float) origin.z + sin * outerZ)
                        .color(rimColor(i, 220))
                        .endVertex();
                buffer.vertex(pose, (float) origin.x + cos * innerX, (float) origin.y,
                                (float) origin.z + sin * innerZ)
                        .color(rimColor(i, 245))
                        .endVertex();
            }

            BufferUploader.drawWithShader(buffer.end());
        } finally {
            PortalRenderTypes.RIM.clearRenderState();
        }
    }

    private static int color(int red, int green, int blue) {
        return 0xFF000000 | (red << 16) | (green << 8) | blue;
    }

    private static float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static int rimColor(int index, int alpha) {
        float wave = 0.75f + 0.25f * (float) Math.sin(index * 0.7f);
        int red = (int) (255 * wave);
        int green = (int) (125 + 80 * wave);
        int blue = 35;
        return (alpha << 24) | (red << 16) | (green << 8) | blue;
    }
}
