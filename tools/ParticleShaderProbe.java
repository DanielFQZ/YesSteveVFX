import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.ZipFile;

import static org.lwjgl.glfw.GLFW.*;
import static org.lwjgl.opengl.GL33C.*;

/**
 * 在隐藏的 OpenGL 上下文中对比 MC/Forge JAR 内的实际粒子候选 shader。
 * 参数：Minecraft 1.20.1 client JAR、Forge universal JAR。
 * 此探针验证 shader 像素输出；不代替 Minecraft 中的渲染阶段、材质状态及模组兼容测试。
 */
public final class ParticleShaderProbe {
    private static ZipFile minecraft;
    private static ZipFile forge;
    private static final int[] COLOR = {80, 220, 120, 255};
    private static final float[][] NORMALS = {
            {0, -1, 0}, {0, 1, 0}, {1, 0, 0}, {-1, 0, 0}, {0, 0, 1}, {0, 0, -1}
    };

    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Expected client.jar and forge-universal.jar");
        try (ZipFile mc = new ZipFile(args[0]); ZipFile fg = new ZipFile(args[1])) {
            minecraft = mc;
            forge = fg;
            if (!glfwInit()) throw new IllegalStateException("Cannot initialize GLFW");
            glfwWindowHint(GLFW_VISIBLE, GLFW_FALSE);
            glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
            glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
            glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
            long window = glfwCreateWindow(16, 16, "Particle shader probe", 0, 0);
            if (window == 0) throw new IllegalStateException("Cannot create hidden OpenGL context");
            try {
                glfwMakeContextCurrent(window);
                GL.createCapabilities();
                System.out.println("GPU: " + glGetString(GL_RENDERER));
                run();
                int error = glGetError();
                if (error != GL_NO_ERROR) throw new AssertionError("OpenGL error: " + error);
                System.out.println("PASS: real shader RGB, alpha cutout and lightmap pixel checks");
            } finally {
                glfwDestroyWindow(window);
                glfwTerminate();
            }
        }
    }

    private static void run() throws Exception {
        int framebuffer = glGenFramebuffers();
        glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
        int target = texture(0, 16, new int[]{0, 0, 0, 0});
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target, 0);
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE)
            throw new AssertionError("Incomplete framebuffer");
        glViewport(0, 0, 16, 16);
        glDisable(GL_BLEND);
        glDisable(GL_DEPTH_TEST);
        glDisable(GL_CULL_FACE);
        glDisable(GL_DITHER);
        glDisable(GL_FRAMEBUFFER_SRGB);
        int image = texture(0, 1, COLOR);
        int overlay = texture(1, 16, new int[]{255, 255, 255, 255});
        int lightmap = texture(2, 16, new int[]{255, 255, 255, 255});
        int vao = glGenVertexArrays();
        int vbo = glGenBuffers();
        glBindVertexArray(vao);
        glBindBuffer(GL_ARRAY_BUFFER, vbo);
        glBufferData(GL_ARRAY_BUFFER, new float[]{-1,-1,0, 1,-1,0, 1,1,0, -1,-1,0, 1,1,0, -1,1,0}, GL_STATIC_DRAW);
        String[] names = {"minecraft:rendertype_entity_cutout_no_cull",
                "minecraft:rendertype_entity_translucent_emissive",
                "forge:rendertype_entity_unlit_translucent"};
        for (String name : names) {
            int program = program(name);
            glUseProgram(program);
            int position = glGetAttribLocation(program, "Position");
            glEnableVertexAttribArray(position);
            glVertexAttribPointer(position, 3, GL_FLOAT, false, 0, 0);
            attribute4(program, "Color", 1, 1, 1, 1);
            int uv = glGetAttribLocation(program, "UV0");
            glVertexAttrib2f(uv, .5f, .5f);
            attributeInt2(program, "UV1", 0, 10);
            attributeInt2(program, "UV2", 240, 240);
            glUniformMatrix4fv(glGetUniformLocation(program, "ModelViewMat"), false, identity4());
            glUniformMatrix4fv(glGetUniformLocation(program, "ProjMat"), false, identity4());
            glUniformMatrix3fv(glGetUniformLocation(program, "IViewRotMat"), false,
                    new float[]{1,0,0, 0,1,0, 0,0,1});
            glUniform4f(glGetUniformLocation(program, "ColorModulator"), 1, 1, 1, 1);
            glUniform3f(glGetUniformLocation(program, "Light0_Direction"), .2f, 1, -.7f);
            glUniform3f(glGetUniformLocation(program, "Light1_Direction"), -.2f, 1, .7f);
            glUniform1f(glGetUniformLocation(program, "FogStart"), 100);
            glUniform1f(glGetUniformLocation(program, "FogEnd"), 200);
            glUniform4f(glGetUniformLocation(program, "FogColor"), 0, 0, 0, 0);
            glUniform1i(glGetUniformLocation(program, "FogShape"), 0);
            for (int i = 0; i < 3; i++) glUniform1i(glGetUniformLocation(program, "Sampler" + i), i);
            boolean unlit = name.startsWith("forge:");
            int normalAttribute = glGetAttribLocation(program, "Normal");
            for (float[] normal : NORMALS) {
                if (normalAttribute >= 0) glVertexAttrib3f(normalAttribute, normal[0], normal[1], normal[2]);
                int[] result = draw();
                System.out.println(name + " normal=" + Arrays.toString(normal) + " RGBA=" + Arrays.toString(result));
                if (unlit) expect(COLOR, result);
                else if (normal[1] == -1) expect(new int[]{32, 88, 48, 255}, result);
            }
            if (unlit) {
                // Alpha-test 仍裁剪透明纹素，半透明纹素不改写其 RGB。
                updateTexture(0, image, 1, new int[]{80, 220, 120, 0});
                expect(new int[]{0, 0, 0, 0}, draw());
                updateTexture(0, image, 1, new int[]{80, 220, 120, 128});
                expect(new int[]{80, 220, 120, 128}, draw());
                updateTexture(0, image, 1, COLOR);
                // Shader 只去掉方向光，仍按 UV2 采样 lightmap。
                updateTexture(2, lightmap, 16, new int[]{128, 128, 128, 255});
                expect(new int[]{40, 110, 60, 255}, draw());
            }
            glDisableVertexAttribArray(position);
            glDeleteProgram(program);
        }
        glDeleteBuffers(vbo);
        glDeleteVertexArrays(vao);
        for (int texture : new int[]{image, overlay, lightmap, target}) glDeleteTextures(texture);
        glDeleteFramebuffers(framebuffer);
    }

    private static int[] draw() {
        glClearColor(0, 0, 0, 0);
        glClear(GL_COLOR_BUFFER_BIT);
        glDrawArrays(GL_TRIANGLES, 0, 6);
        ByteBuffer pixel = BufferUtils.createByteBuffer(4);
        glReadPixels(8, 8, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel);
        return new int[]{pixel.get(0) & 255, pixel.get(1) & 255, pixel.get(2) & 255, pixel.get(3) & 255};
    }

    private static void expect(int[] expected, int[] actual) {
        for (int i = 0; i < 4; i++) {
            if (Math.abs(expected[i] - actual[i]) > 1)
                throw new AssertionError(Arrays.toString(expected) + " != " + Arrays.toString(actual));
        }
    }

    private static int texture(int unit, int size, int[] rgba) {
        int texture = glGenTextures();
        updateTexture(unit, texture, size, rgba);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        return texture;
    }

    private static void updateTexture(int unit, int texture, int size, int[] rgba) {
        glActiveTexture(GL_TEXTURE0 + unit);
        glBindTexture(GL_TEXTURE_2D, texture);
        ByteBuffer bytes = BufferUtils.createByteBuffer(size * size * 4);
        for (int i = 0; i < size * size; i++) for (int c : rgba) bytes.put((byte)c);
        bytes.flip();
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, size, size, 0, GL_RGBA, GL_UNSIGNED_BYTE, bytes);
    }

    private static void attribute4(int program, String name, float x, float y, float z, float w) {
        int location = glGetAttribLocation(program, name);
        if (location >= 0) glVertexAttrib4f(location, x, y, z, w);
    }

    private static void attributeInt2(int program, String name, int x, int y) {
        int location = glGetAttribLocation(program, name);
        if (location >= 0) glVertexAttribI2i(location, x, y);
    }

    private static float[] identity4() {
        return new float[]{1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
    }

    private static int program(String id) throws Exception {
        int program = glCreateProgram();
        for (String extension : new String[]{"vsh", "fsh"}) {
            String[] parts = id.split(":");
            String source = read(parts[0], "core/" + parts[1] + "." + extension);
            int shader = glCreateShader(extension.equals("vsh") ? GL_VERTEX_SHADER : GL_FRAGMENT_SHADER);
            glShaderSource(shader, source);
            glCompileShader(shader);
            if (glGetShaderi(shader, GL_COMPILE_STATUS) == GL_FALSE)
                throw new AssertionError(id + ": " + glGetShaderInfoLog(shader));
            glAttachShader(program, shader);
            glDeleteShader(shader);
        }
        glLinkProgram(program);
        if (glGetProgrami(program, GL_LINK_STATUS) == GL_FALSE)
            throw new AssertionError(glGetProgramInfoLog(program));
        return program;
    }

    private static String read(String namespace, String path) throws Exception {
        ZipFile jar = namespace.equals("forge") ? forge : minecraft;
        var entry = jar.getEntry("assets/" + namespace + "/shaders/" + path);
        if (entry == null) throw new IllegalArgumentException("Missing shader: " + namespace + ":" + path);
        String source;
        try (var input = jar.getInputStream(entry)) {
            source = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        for (String include : new String[]{"light.glsl", "fog.glsl"}) {
            String directive = "#moj_import <" + include + ">";
            if (source.contains(directive))
                source = source.replace(directive, read("minecraft", "include/" + include)
                        .replaceAll("(?m)^#version.*$", ""));
        }
        return source;
    }
}
