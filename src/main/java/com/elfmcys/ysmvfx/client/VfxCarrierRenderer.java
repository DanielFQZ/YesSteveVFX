package com.elfmcys.ysmvfx.client;

import com.elfmcys.ysmvfx.entity.VfxCarrierEntity;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.model.EntityModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.LivingEntityRenderer;
import net.minecraft.resources.ResourceLocation;

import java.util.List;
import java.util.Map;

/** Empty vanilla renderer used as the Forge LivingEntity hook for eyelib. */
public final class VfxCarrierRenderer extends LivingEntityRenderer<VfxCarrierEntity, VfxCarrierRenderer.EmptyModel> {
    public VfxCarrierRenderer(EntityRendererProvider.Context context) {
        super(context, new EmptyModel(), 0.0F);
    }

    @Override
    public ResourceLocation getTextureLocation(VfxCarrierEntity entity) {
        // The two-argument constructor is present throughout the 1.20.1 Forge
        // 47.x line; fromNamespaceAndPath was added only in later mappings.
        return new ResourceLocation("yesstevevfx", "empty");
    }

    public static final class EmptyModel extends EntityModel<VfxCarrierEntity> {
        public EmptyModel() {
            super();
        }

        @Override
        public void setupAnim(VfxCarrierEntity entity, float limbSwing, float limbSwingAmount,
                              float ageInTicks, float netHeadYaw, float headPitch) {
        }

        @Override
        public void renderToBuffer(PoseStack poseStack, VertexConsumer buffer, int packedLight,
                                   int packedOverlay, float red, float green, float blue, float alpha) {
        }
    }
}
