package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.YesSteveVfx;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.client.renderer.RenderStateShard;
import net.minecraft.client.renderer.RenderType;

/** Render states kept in one place so the render event remains readable. */
final class PortalRenderTypes {
    /**
     * Opaque, unlit portal interior. It deliberately writes depth: terrain
     * inside the aperture is hidden, while entities closer to the camera can
     * still pass the depth test and appear to come through the opening.
     */
    static final RenderType INTERIOR = RenderType.create(
            YesSteveVfx.MOD_ID + ":portal_interior",
            DefaultVertexFormat.POSITION_COLOR,
            com.mojang.blaze3d.vertex.VertexFormat.Mode.TRIANGLE_FAN,
            256,
            false,
            false,
            RenderType.CompositeState.builder()
                    .setShaderState(new RenderStateShard.ShaderStateShard(GameRenderer::getPositionColorShader))
                    .setTransparencyState(Access.OPAQUE)
                    .setDepthTestState(Access.LEQUAL)
                    .setCullState(Access.NO_CULL)
                    .setWriteMaskState(Access.COLOR_DEPTH)
                    .setLayeringState(Access.VIEW_OFFSET)
                    .setOutputState(Access.MAIN)
                    .createCompositeState(false)
    );

    static final RenderType RIM = RenderType.create(
            YesSteveVfx.MOD_ID + ":portal_rim",
            DefaultVertexFormat.POSITION_COLOR,
            com.mojang.blaze3d.vertex.VertexFormat.Mode.TRIANGLE_STRIP,
            256,
            false,
            false,
            RenderType.CompositeState.builder()
                    .setShaderState(new RenderStateShard.ShaderStateShard(GameRenderer::getPositionColorShader))
                    .setTransparencyState(Access.TRANSLUCENT)
                    .setDepthTestState(Access.LEQUAL)
                    .setCullState(Access.NO_CULL)
                    .setWriteMaskState(Access.COLOR)
                    .setLayeringState(Access.VIEW_OFFSET)
                    .setOutputState(Access.MAIN)
                    .createCompositeState(false)
    );

    private PortalRenderTypes() {
    }

    /** RenderStateShard keeps its standard states protected in 1.20.1. */
    private static final class Access extends RenderStateShard {
        private static final TransparencyStateShard OPAQUE = NO_TRANSPARENCY;
        private static final TransparencyStateShard TRANSLUCENT = TRANSLUCENT_TRANSPARENCY;
        private static final DepthTestStateShard LEQUAL = LEQUAL_DEPTH_TEST;
        private static final CullStateShard NO_CULL = RenderStateShard.NO_CULL;
        private static final WriteMaskStateShard COLOR_DEPTH = COLOR_DEPTH_WRITE;
        private static final WriteMaskStateShard COLOR = COLOR_WRITE;
        private static final LayeringStateShard VIEW_OFFSET = VIEW_OFFSET_Z_LAYERING;
        private static final OutputStateShard MAIN = MAIN_TARGET;

        private Access() {
            super("yesstevevfx_access", () -> { }, () -> { });
        }
    }
}
