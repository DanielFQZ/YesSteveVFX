package com.elfmcys.ysmvfx.compat.eyelib;

import com.elfmcys.ysmvfx.asset.EffectAssetBundle;
import com.elfmcys.ysmvfx.client.CarrierFactory;
import com.elfmcys.ysmvfx.client.EffectBackend;
import com.elfmcys.ysmvfx.client.EffectHandle;
import com.elfmcys.ysmvfx.client.EffectPlayRequest;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import io.github.tt432.eyelib.animation.AnimationComponent;
import io.github.tt432.eyelib.animation.Animation;
import io.github.tt432.eyelib.animation.AnimationRegistries;
import io.github.tt432.eyelib.animation.ModelPoseTransforms;
import io.github.tt432.eyelib.animation.ModelRuntimeData;
import io.github.tt432.eyelib.animation.bedrock.BrAnimation;
import io.github.tt432.eyelib.animation.bedrock.controller.BrAnimationControllers;
import io.github.tt432.eyelib.bridge.client.render.texture.NativeImagePort;
import io.github.tt432.eyelib.bridge.particle.ParticlePort;
import io.github.tt432.eyelib.capability.RenderData;
import io.github.tt432.eyelib.client.manager.ClientEntityManager;
import io.github.tt432.eyelib.client.manager.ModelManager;
import io.github.tt432.eyelib.client.manager.RenderControllerManager;
import io.github.tt432.eyelib.client.render.EntityRenderOrchestrator;
import io.github.tt432.eyelib.client.render.controller.RenderControllers;
import io.github.tt432.eyelib.client.registry.AnimationAssetRegistry;
import io.github.tt432.eyelib.importer.animation.bedrock.BrAnimationSet;
import io.github.tt432.eyelib.importer.animation.bedrock.controller.BrAnimationControllerSet;
import io.github.tt432.eyelib.importer.entity.BrClientEntity;
import io.github.tt432.eyelib.importer.model.importer.BedrockGeometryImporter;
import io.github.tt432.eyelib.importer.particle.BrParticle;
import io.github.tt432.eyelib.model.Model;
import io.github.tt432.eyelib.model.GlobalBoneIdHandler;
import io.github.tt432.eyelib.particle.loading.ParticleDefinitionRegistry;
import io.github.tt432.eyelib.particle.runtime.ParticleDefinition;
import io.github.tt432.eyelib.particle.runtime.ParticleDefinitionAdapter;
import io.github.tt432.eyelib.util.repository.Repository;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;
import org.joml.Vector3f;
import org.jetbrains.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collection;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Direct eyelib integration.  This source set is deliberately optional: the normal
 * VFX build does not mention eyelib, while a distribution that includes eyelib adds
 * this directory to the client compile source set.
 *
 * <p>The backend owns only resources whose identifiers are in the {@code yesstevevfx}
 * namespace.  It therefore never calls a global {@code replaceAll} on a registry
 * containing another mod's assets.</p>
 */
public final class EyelibBackend implements EffectBackend {
    private static final Logger LOGGER = LoggerFactory.getLogger(EyelibBackend.class);
    private static final String NAMESPACE = "yesstevevfx";

    private final Map<EffectHandle, Instance> instances = new LinkedHashMap<>();
    private final Set<String> ownedModelIds = new HashSet<>();
    private final Set<String> ownedEntityIds = new HashSet<>();
    private final Set<String> ownedRenderControllerIds = new HashSet<>();
    private final Set<String> ownedAnimationIds = new HashSet<>();
    private final Set<String> ownedControllerIds = new HashSet<>();
    private final Set<String> ownedParticleIds = new HashSet<>();
    private final Set<String> ownedTextureIds = new HashSet<>();
    private Map<String, byte[]> ownedTextureBytes = Map.of();
    private Map<String, EffectAssetBundle> loadedBundles = Map.of();

    @Override
    public void reload(Map<String, EffectAssetBundle> bundles) throws Exception {
        Objects.requireNonNull(bundles, "bundles");
        Publication publication = parse(bundles);
        BackendSnapshot previous = snapshot();

        try {
            // Publish only after every JSON file in every bundle has parsed
            // successfully. If a registry or texture rejects publication,
            // restore the complete previous snapshot before propagating the
            // error so /vfx_client reload is genuinely transactional.
            clear();
            removeOwnedResources();
            ModelManager.INSTANCE.putAll(publication.models);
            ClientEntityManager.INSTANCE.putAll(publication.entities);
            RenderControllerManager.INSTANCE.putAll(publication.renderControllers);
            // 21.1.14 has one global staging slot. Publishing individual entries
            // preserves eyelib's loaded assets and other mods' animation sources.
            publication.animations.values().forEach(AnimationAssetRegistry::publishAnimation);
            publication.controllers.values().forEach(AnimationAssetRegistry::publishAnimationController);
            publication.particles.values().forEach(ParticleDefinitionRegistry.publisher()::publishParticle);
            publication.textures.forEach((id, bytes) -> {
                try {
                    NativeImagePort.loadAndUpload(id, new ByteArrayInputStream(bytes));
                } catch (Exception e) {
                    throw new PublicationException("Cannot upload texture " + id, e);
                }
            });

            ownedModelIds.addAll(publication.models.keySet());
            ownedEntityIds.addAll(publication.entities.keySet());
            ownedRenderControllerIds.addAll(publication.renderControllers.keySet());
            publication.animations.values().forEach(value -> ownedAnimationIds.addAll(value.animations().keySet()));
            publication.controllers.values().forEach(value -> ownedControllerIds.addAll(value.animationControllers().keySet()));
            ownedParticleIds.addAll(publication.particles.keySet());
            ownedTextureIds.addAll(publication.textures.keySet());
            ownedTextureBytes = copyBytes(publication.textures);
            loadedBundles = Map.copyOf(bundles);
        } catch (Exception | LinkageError failure) {
            rollback(previous, publication);
            throw failure;
        }
    }

    @Override
    public @Nullable EffectHandle play(EffectPlayRequest request, EffectAssetBundle bundle,
                                       CarrierFactory carrierFactory, ClientLevel level) throws Exception {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(bundle, "bundle");
        Objects.requireNonNull(carrierFactory, "carrierFactory");
        Objects.requireNonNull(level, "level");
        if (!loadedBundles.containsKey(bundle.definition().id())) {
            throw new IllegalStateException("Effect bundle has not been reloaded: " + bundle.definition().id());
        }

        LivingEntity carrier = carrierFactory.create(level, request);
        if (carrier == null) {
            return null;
        }
        carrier.moveTo(request.position().x, request.position().y, request.position().z,
                request.yaw(), request.pitch());
        try {
            RenderData<?> data = RenderData.getComponent(carrier);
            data.ensureOwner(carrier);
            BrClientEntity clientEntity = parseClientEntity(bundle,
                    bundle.read(bundle.definition().clientEntity()));
            EntityRenderOrchestrator.setupClientEntity(clientEntity, data).forEach(Runnable::run);
        } catch (Exception | LinkageError exception) {
            carrierFactory.remove(carrier);
            throw exception;
        }

        Instance instance = new Instance(carrier, carrierFactory, bundle, request.clientTick());
        instances.put(instance, instance);
        return instance;
    }

    @Override
    public boolean stop(EffectHandle handle) {
        Instance instance = instances.remove(handle);
        if (instance == null) {
            return false;
        }
        trackParticles(instance);
        instance.particleIds.forEach(ParticlePort.getSpawnAdapter()::remove);
        instance.factory.remove(instance.carrier);
        return true;
    }

    @Override
    public boolean set(EffectHandle handle, String name, double value) {
        if (name == null || name.isBlank() || !Double.isFinite(value)) {
            return false;
        }
        Instance instance = instances.get(handle);
        if (instance == null) {
            return false;
        }
        RenderData<?> data = RenderData.getComponent(instance.carrier);
        data.ensureOwner(instance.carrier);
        data.requireScope().set(name.indexOf('.') >= 0 ? name : "variable." + name, value);
        return true;
    }

    @Override
    public void update(EffectHandle handle, EffectPlayRequest request) {
        Instance instance = instances.get(handle);
        if (instance == null || request == null) {
            return;
        }
        /*
         * Keep the carrier's previous transform intact.  moveTo() is intended
         * for teleports/spawns and also resets xo/yo/zo and the old rotations.
         * Calling it once per client tick makes both Minecraft's entity renderer
         * and eyelib's locator resolver see no interval to interpolate, so a
         * following effect advances in visible 20 Hz steps.  setPos and the
         * current rotation setters only update the current transform; the
         * renderer can then interpolate from the previous tick exactly like
         * the source entity.  LivingEntity's
         * body/head rotations are updated as well because eyelib's locator
         * resolver interpolates those fields for attached particles.
         */
        instance.carrier.setPos(request.position().x, request.position().y, request.position().z);
        instance.carrier.setYRot(request.yaw());
        instance.carrier.setXRot(request.pitch());
        instance.carrier.setYBodyRot(request.yaw());
        instance.carrier.setYHeadRot(request.yaw());
    }

    @Override
    public List<AABB> hitBoxes(EffectHandle handle) {
        if (!(handle instanceof Instance instance)) return List.of();
        RenderData<?> data = RenderData.getComponent(instance.carrier);
        if (data == null || data.getAnimationComponent() == null) return List.of();
        ModelRuntimeData runtime = data.getAnimationComponent().tickedInfos;
        if (runtime == null) runtime = ModelRuntimeData.EMPTY;
        Vec3 origin = instance.carrier.position();
        Matrix4f root = new Matrix4f()
                .translate((float) origin.x, (float) origin.y, (float) origin.z)
                .rotateY((float) Math.toRadians(180.0F - instance.carrier.getYRot()));
        List<AABB> result = new ArrayList<>();
        if (data.getModelComponents() == null) return List.of();
        for (var component : data.getModelComponents()) {
            Model model = component.getModel();
            if (model == null) continue;
            for (Model.Bone bone : model.toplevelBones().values()) {
                collectHitBoxes(bone, root, runtime, result);
            }
        }
        return List.copyOf(result);
    }

    private static void collectHitBoxes(Model.Bone bone, Matrix4f parent, ModelRuntimeData runtime,
                                        List<AABB> output) {
        Vector3f scale = new Vector3f(runtime.scale(bone));
        if (Math.abs(scale.x) < 1.0E-5F || Math.abs(scale.y) < 1.0E-5F || Math.abs(scale.z) < 1.0E-5F) {
            return;
        }
        Matrix4f pose = new Matrix4f(parent);
        ModelPoseTransforms.applyBone(pose, bone, runtime);
        String name = GlobalBoneIdHandler.get(bone.id());
        String binding = bone.binding();
        boolean hitBlock = (name != null && name.toLowerCase(java.util.Locale.ROOT).startsWith("hitblock"))
                || (binding != null && binding.toLowerCase(java.util.Locale.ROOT).startsWith("hitblock"));
        if (hitBlock) {
            AABB box = cubeBounds(bone, pose);
            if (box != null) output.add(box);
        }
        for (Model.Bone child : bone.children().values()) {
            collectHitBoxes(child, pose, runtime, output);
        }
    }

    private static AABB cubeBounds(Model.Bone bone, Matrix4f pose) {
        double minX = Double.POSITIVE_INFINITY, minY = Double.POSITIVE_INFINITY, minZ = Double.POSITIVE_INFINITY;
        double maxX = Double.NEGATIVE_INFINITY, maxY = Double.NEGATIVE_INFINITY, maxZ = Double.NEGATIVE_INFINITY;
        for (Model.Cube cube : bone.cubes()) {
            for (Model.Face face : cube.faces()) {
                for (Model.Vertex vertex : face.vertexes()) {
                    Vector3f point = new Vector3f(vertex.position());
                    pose.transformPosition(point);
                    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); minZ = Math.min(minZ, point.z);
                    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); maxZ = Math.max(maxZ, point.z);
                }
            }
        }
        return Double.isFinite(minX) ? new AABB(minX, minY, minZ, maxX, maxY, maxZ) : null;
    }

    @Override
    public void clear() {
        for (Instance instance : List.copyOf(instances.values())) {
            stop(instance);
        }
    }

    @Override
    public void unload() {
        clear();
        removeOwnedResources();
        loadedBundles = Map.of();
    }

    @Override
    public void tick(ClientLevel level) {
        long now = level.getGameTime();
        for (Instance instance : List.copyOf(instances.values())) {
            if (instance.carrier.level() != level || !instance.carrier.isAlive()
                    || now - instance.startTick >= instance.bundle.definition().durationTicks()) {
                stop(instance);
            }
        }
    }

    /** Capture public animation output each rendered frame, including completed clips. */
    public void afterRenderFrame() {
        instances.values().forEach(EyelibBackend::trackParticles);
    }

    private static void trackParticles(Instance instance) {
        RenderData<?> data = RenderData.getComponent(instance.carrier);
        AnimationComponent animation = data.getAnimationComponent();
        if (animation.effects != null) {
            animation.effects.particles.forEach(particles -> particles.forEach(
                    particle -> instance.particleIds.add(particle.particleUUID())));
        }
    }

    private void removeOwnedResources() {
        removeOwned(ModelManager.INSTANCE, ownedModelIds);
        removeOwned(ClientEntityManager.INSTANCE, ownedEntityIds);
        removeOwned(RenderControllerManager.INSTANCE, ownedRenderControllerIds);
        removeOwned(AnimationRegistries.animation(), ownedAnimationIds);
        removeOwned(AnimationRegistries.animation(), ownedControllerIds);
        removeOwned(ParticleDefinitionRegistry.store(), ownedParticleIds);
        ownedTextureIds.forEach(id -> Minecraft.getInstance().getTextureManager().release(
                ResourceLocation.tryParse(id)));
        ownedModelIds.clear();
        ownedEntityIds.clear();
        ownedRenderControllerIds.clear();
        ownedAnimationIds.clear();
        ownedControllerIds.clear();
        ownedParticleIds.clear();
        ownedTextureIds.clear();
        ownedTextureBytes = Map.of();
    }

    private BackendSnapshot snapshot() {
        return new BackendSnapshot(
                new LinkedHashMap<>(ModelManager.INSTANCE.all()),
                new LinkedHashMap<>(ClientEntityManager.INSTANCE.all()),
                new LinkedHashMap<>(RenderControllerManager.INSTANCE.all()),
                new LinkedHashMap<>(AnimationRegistries.animation().all()),
                new LinkedHashMap<>(ParticleDefinitionRegistry.store().all()),
                new HashSet<>(ownedModelIds), new HashSet<>(ownedEntityIds),
                new HashSet<>(ownedRenderControllerIds), new HashSet<>(ownedAnimationIds),
                new HashSet<>(ownedControllerIds), new HashSet<>(ownedParticleIds),
                new HashSet<>(ownedTextureIds), copyBytes(ownedTextureBytes), loadedBundles);
    }

    private void rollback(BackendSnapshot previous, Publication publication) {
        try {
            // A failed publication may have partially inserted entries. Restore
            // each repository snapshot as one operation before restoring our
            // ownership bookkeeping.
            ModelManager.INSTANCE.replaceAll(previous.models);
            ClientEntityManager.INSTANCE.replaceAll(previous.entities);
            RenderControllerManager.INSTANCE.replaceAll(previous.renderControllers);
            AnimationRegistries.animation().replaceAll(previous.animations);
            ParticleDefinitionRegistry.store().replaceAll(previous.particles);

            Set<String> texturesToRelease = new HashSet<>(publication.textures.keySet());
            texturesToRelease.addAll(previous.ownedTextureIds);
            texturesToRelease.forEach(id -> Minecraft.getInstance().getTextureManager().release(
                    ResourceLocation.tryParse(id)));
            previous.textureBytes.forEach((id, bytes) -> {
                try {
                    NativeImagePort.loadAndUpload(id, new ByteArrayInputStream(bytes));
                } catch (Exception e) {
                    LOGGER.warn("Could not restore VFX texture {} after failed reload", id, e);
                }
            });

            ownedModelIds.clear(); ownedModelIds.addAll(previous.ownedModelIds);
            ownedEntityIds.clear(); ownedEntityIds.addAll(previous.ownedEntityIds);
            ownedRenderControllerIds.clear(); ownedRenderControllerIds.addAll(previous.ownedRenderControllerIds);
            ownedAnimationIds.clear(); ownedAnimationIds.addAll(previous.ownedAnimationIds);
            ownedControllerIds.clear(); ownedControllerIds.addAll(previous.ownedControllerIds);
            ownedParticleIds.clear(); ownedParticleIds.addAll(previous.ownedParticleIds);
            ownedTextureIds.clear(); ownedTextureIds.addAll(previous.ownedTextureIds);
            ownedTextureBytes = copyBytes(previous.textureBytes);
            loadedBundles = previous.loadedBundles;
        } catch (RuntimeException | LinkageError rollbackFailure) {
            LOGGER.error("Could not restore the previous YesSteveVFX resource snapshot", rollbackFailure);
        }
    }

    private static Map<String, byte[]> copyBytes(Map<String, byte[]> source) {
        Map<String, byte[]> copy = new LinkedHashMap<>();
        source.forEach((id, bytes) -> copy.put(id, bytes.clone()));
        return Map.copyOf(copy);
    }

    private static <T> void removeOwned(Repository<T> registry, Set<String> owned) {
        if (owned.isEmpty()) return;
        Map<String, T> remaining = new LinkedHashMap<>(registry.all());
        owned.forEach(remaining::remove);
        registry.replaceAll(remaining);
    }

    private Publication parse(Map<String, EffectAssetBundle> bundles) throws Exception {
        Publication result = new Publication();
        Map<String, String> modelOwners = new HashMap<>();
        Map<String, String> entityOwners = new HashMap<>();
        Map<String, String> animationOwners = new HashMap<>();
        Map<String, String> animationIdOwners = new HashMap<>();
        Map<String, String> controllerOwners = new HashMap<>();
        Map<String, String> controllerIdOwners = new HashMap<>();
        Map<String, String> renderControllerOwners = new HashMap<>();
        Map<String, String> particleOwners = new HashMap<>();
        Map<String, String> textureOwners = new HashMap<>();
        for (EffectAssetBundle bundle : bundles.values()) {
            byte[] entityBytes = bundle.read(bundle.definition().clientEntity());
            BrClientEntity entity = parseClientEntity(bundle, entityBytes);
            registerUnique(result.entities, entityOwners, entity.identifier(), entity,
                    digest(entityBytes), "client entity");

            for (Map.Entry<String, byte[]> file : bundle.files().entrySet()) {
                String path = file.getKey();
                JsonElement json;
                if (path.startsWith("assets/eyelib/models/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    validateBedrockTextureBounds(json, path);
                    Map<String, Model> models = BedrockGeometryImporter.importJson(json.getAsJsonObject());
                    String digest = digest(file.getValue());
                    models.forEach((id, model) -> registerUnique(result.models, modelOwners, id, model,
                            digest, "geometry"));
                    requireNamespace(models.keySet(), "geometry");
                } else if (path.startsWith("assets/eyelib/animations/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    BrAnimationSet set = BrAnimationSet.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid animation: " + path));
                    BrAnimation animation = BrAnimation.fromSchemaSet(set);
                    String digest = digest(file.getValue());
                    registerUnique(result.animations, animationOwners, path, animation, digest, "animation file");
                    animation.animations().keySet().forEach(id -> registerId(animationIdOwners, id, digest, "animation"));
                    requireNamespace(animation.animations().keySet(), "animation");
                } else if (path.startsWith("assets/eyelib/animation_controllers/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    BrAnimationControllerSet set = BrAnimationControllerSet.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid animation controller: " + path));
                    BrAnimationControllers controllers = BrAnimationControllers.fromSchemaSet(set);
                    String digest = digest(file.getValue());
                    registerUnique(result.controllers, controllerOwners, path, controllers, digest, "controller file");
                    controllers.animationControllers().keySet().forEach(id -> registerId(
                            controllerIdOwners, id, digest, "animation controller"));
                    requireNamespace(controllers.animationControllers().keySet(), "controller.animation");
                } else if (path.startsWith("assets/eyelib/render_controllers/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    RenderControllers controllers = RenderControllers.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid render controller: " + path));
                    String digest = digest(file.getValue());
                    controllers.render_controllers().forEach((id, value) -> registerUnique(
                            result.renderControllers, renderControllerOwners, id, value, digest, "render controller"));
                    requireNamespace(controllers.render_controllers().keySet(), "controller.render");
                } else if (path.startsWith("assets/eyelib/particles/") && path.endsWith(".json")) {
                    json = parseJson(path, file.getValue());
                    BrParticle particle = BrParticle.CODEC.parse(JsonOps.INSTANCE, json).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid particle: " + path));
                    if (!particle.particleEffect().description().identifier().startsWith(NAMESPACE + ":")) {
                        throw new IllegalArgumentException("Particle identifier must use " + NAMESPACE + ": " + path);
                    }
                    ParticleDefinition definition = ParticleDefinitionAdapter.fromSchema(particle).result()
                            .orElseThrow(() -> new IllegalArgumentException("Invalid particle components: " + path));
                    registerUnique(result.particles, particleOwners, definition.identifier(), definition,
                            digest(file.getValue()), "particle");
                } else if (path.startsWith("assets/eyelib/textures/") && path.endsWith(".png")) {
                    // Bedrock entity textures normally omit .png, while the
                    // eyelib particle renderer appends .png before asking
                    // TextureManager for the image. Publish both spellings so
                    // one uploaded asset works for model and particle paths.
                    String relative = path.substring("assets/eyelib/".length(), path.length() - ".png".length());
                    byte[] bytes = file.getValue().clone();
                    registerUnique(result.textures, textureOwners, NAMESPACE + ":" + relative, bytes.clone(),
                            digest(bytes), "texture");
                    registerUnique(result.textures, textureOwners, NAMESPACE + ":" + relative + ".png", bytes,
                            digest(bytes), "texture");
                } else if (path.startsWith("assets/eyelib/particles/") && path.endsWith(".png")) {
                    // Older editor exports placed particle sprite PNGs beside
                    // the particle JSON. Keep those packs loadable while the
                    // editor writes new images to assets/eyelib/textures/.
                    String relative = path.substring("assets/eyelib/particles/".length(), path.length() - ".png".length());
                    byte[] bytes = file.getValue().clone();
                    String digest = digest(bytes);
                    registerUnique(result.textures, textureOwners, NAMESPACE + ":particles/" + relative, bytes.clone(), digest, "texture");
                    registerUnique(result.textures, textureOwners, NAMESPACE + ":particles/" + relative + ".png", bytes.clone(), digest, "texture");
                    registerUnique(result.textures, textureOwners, NAMESPACE + ":textures/" + relative, bytes.clone(), digest, "texture");
                    registerUnique(result.textures, textureOwners, NAMESPACE + ":textures/" + relative + ".png", bytes, digest, "texture");
                }
            }
        }
        return result;
    }

    /**
     * eyelib's model baker samples the texture while classifying cube faces. A
     * malformed Bedrock box-UV can otherwise reach NativeImage with an out of
     * range coordinate and crash the render thread. Reject it during reload,
     * where the command can report a bad asset and keep the client alive.
     */
    private static void validateBedrockTextureBounds(JsonElement root, String path) {
        if (!root.isJsonObject()) return;
        JsonElement geometries = root.getAsJsonObject().get("minecraft:geometry");
        if (geometries == null || !geometries.isJsonArray()) return;
        for (JsonElement geometry : geometries.getAsJsonArray()) {
            if (!geometry.isJsonObject()) continue;
            JsonObject object = geometry.getAsJsonObject();
            JsonObject description = object.getAsJsonObject("description");
            if (description == null) continue;
            int textureWidth = positiveInt(description, "texture_width", path);
            int textureHeight = positiveInt(description, "texture_height", path);
            JsonElement bones = object.get("bones");
            if (bones != null && bones.isJsonArray()) {
                for (JsonElement bone : bones.getAsJsonArray()) {
                    validateBoneTextureBounds(bone, textureWidth, textureHeight, path);
                }
            }
        }
    }

    private static void validateBoneTextureBounds(JsonElement bone, int textureWidth, int textureHeight, String path) {
        if (!bone.isJsonObject()) return;
        JsonObject object = bone.getAsJsonObject();
        JsonElement cubes = object.get("cubes");
        if (cubes != null && cubes.isJsonArray()) {
            for (JsonElement cube : cubes.getAsJsonArray()) {
                if (!cube.isJsonObject()) continue;
                JsonObject c = cube.getAsJsonObject();
                JsonElement uv = c.get("uv");
                JsonElement size = c.get("size");
                if (uv != null && uv.isJsonArray() && size != null && size.isJsonArray()
                        && uv.getAsJsonArray().size() >= 2 && size.getAsJsonArray().size() >= 3) {
                    double u = number(uv.getAsJsonArray().get(0), path);
                    double v = number(uv.getAsJsonArray().get(1), path);
                    double x = Math.abs(number(size.getAsJsonArray().get(0), path));
                    double y = Math.abs(number(size.getAsJsonArray().get(1), path));
                    double z = Math.abs(number(size.getAsJsonArray().get(2), path));
                    double requiredWidth = u + 2.0 * (x + z);
                    double requiredHeight = v + y + z;
                    if (u < 0 || v < 0 || requiredWidth > textureWidth || requiredHeight > textureHeight) {
                        throw new IllegalArgumentException("Bedrock box UV exceeds texture bounds in " + path
                                + " (required at least " + Math.ceil(requiredWidth) + "x"
                                + Math.ceil(requiredHeight) + ", declared " + textureWidth + "x" + textureHeight + ")");
                    }
                }
            }
        }
        JsonElement children = object.get("children");
        if (children != null && children.isJsonArray()) {
            for (JsonElement child : children.getAsJsonArray()) {
                validateBoneTextureBounds(child, textureWidth, textureHeight, path);
            }
        }
    }

    private static int positiveInt(JsonObject object, String key, String path) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) return 1;
        int result = value.getAsInt();
        if (result <= 0) throw new IllegalArgumentException("Texture dimension must be positive in " + path);
        return result;
    }

    private static double number(JsonElement value, String path) {
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("Model coordinate must be numeric in " + path);
        }
        return value.getAsDouble();
    }

    private static BrClientEntity parseClientEntity(EffectAssetBundle bundle, byte[] bytes) throws Exception {
        JsonElement json = parseJson(bundle.definition().clientEntity(), bytes);
        BrClientEntity entity = BrClientEntity.CODEC.parse(JsonOps.INSTANCE, json).result()
                .orElseThrow(() -> new IllegalArgumentException("Invalid client entity: " + bundle.definition().clientEntity()));
        if (!entity.identifier().startsWith(NAMESPACE + ":")) {
            throw new IllegalArgumentException("Client entity identifier must use " + NAMESPACE + ":");
        }
        requireNamespace(entity.geometry().values(), "geometry");
        for (String animation : entity.animations().values()) {
            if (!animation.startsWith("animation." + NAMESPACE + ".")
                    && !animation.startsWith("controller.animation." + NAMESPACE + ".")) {
                throw new IllegalArgumentException("Animation reference outside VFX namespace: " + animation);
            }
        }
        requireNamespace(entity.render_controllers(), "controller.render");
        for (String particle : entity.particle_effects().values()) {
            if (!particle.startsWith(NAMESPACE + ":")) {
                throw new IllegalArgumentException("Particle reference must use " + NAMESPACE + ": " + particle);
            }
        }
        return entity;
    }

    private static JsonElement parseJson(String path, byte[] bytes) {
        try {
            return JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            throw new PublicationException("Invalid JSON: " + path, e);
        }
    }

    private static void requireNamespace(Collection<String> ids, String prefix) {
        for (String id : ids) {
            if (!id.startsWith(prefix + "." + NAMESPACE + ".")) {
                throw new IllegalArgumentException("eyelib asset id must start with " + prefix + "." + NAMESPACE + ": " + id);
            }
        }
    }

    private static <T> void registerUnique(Map<String, T> target, Map<String, String> owners,
                                           String id, T value, String digest, String kind) {
        String previous = owners.putIfAbsent(id, digest);
        if (previous != null) {
            if (!previous.equals(digest)) {
                throw new IllegalArgumentException("Conflicting " + kind + " id in VFX namespace: " + id);
            }
            return;
        }
        target.put(id, value);
    }

    private static void registerId(Map<String, String> owners, String id, String digest, String kind) {
        String previous = owners.putIfAbsent(id, digest);
        if (previous != null && !previous.equals(digest)) {
            throw new IllegalArgumentException("Conflicting " + kind + " id in VFX namespace: " + id);
        }
    }

    private static String digest(byte[] bytes) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder value = new StringBuilder(hash.length * 2);
            for (byte part : hash) value.append(String.format("%02x", part));
            return value.toString();
        } catch (Exception e) {
            throw new IllegalStateException("Cannot hash VFX resource", e);
        }
    }

    private static final class Publication {
        final Map<String, Model> models = new LinkedHashMap<>();
        final Map<String, BrClientEntity> entities = new LinkedHashMap<>();
        final Map<String, BrAnimation> animations = new LinkedHashMap<>();
        final Map<String, BrAnimationControllers> controllers = new LinkedHashMap<>();
        final Map<String, io.github.tt432.eyelib.client.render.controller.RenderControllerEntry> renderControllers = new LinkedHashMap<>();
        final Map<String, ParticleDefinition> particles = new LinkedHashMap<>();
        final Map<String, byte[]> textures = new LinkedHashMap<>();
    }

    private record BackendSnapshot(
            Map<String, Model> models,
            Map<String, BrClientEntity> entities,
            Map<String, io.github.tt432.eyelib.client.render.controller.RenderControllerEntry> renderControllers,
            Map<String, Animation> animations,
            Map<String, ParticleDefinition> particles,
            Set<String> ownedModelIds, Set<String> ownedEntityIds,
            Set<String> ownedRenderControllerIds, Set<String> ownedAnimationIds,
            Set<String> ownedControllerIds, Set<String> ownedParticleIds,
            Set<String> ownedTextureIds, Map<String, byte[]> textureBytes,
            Map<String, EffectAssetBundle> loadedBundles) {
    }

    private static final class Instance implements EffectHandle {
        final LivingEntity carrier;
        final CarrierFactory factory;
        final EffectAssetBundle bundle;
        final long startTick;
        final Set<String> particleIds = new HashSet<>();

        Instance(LivingEntity carrier, CarrierFactory factory, EffectAssetBundle bundle, long startTick) {
            this.carrier = carrier;
            this.factory = factory;
            this.bundle = bundle;
            this.startTick = startTick;
        }

        @Override
        public LivingEntity carrier() {
            return carrier;
        }
    }

    private static final class PublicationException extends RuntimeException {
        PublicationException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
