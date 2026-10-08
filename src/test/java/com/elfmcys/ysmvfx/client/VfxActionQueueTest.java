package com.elfmcys.ysmvfx.client;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VfxActionQueueTest {
    private static final UUID SOURCE = UUID.randomUUID();

    @Test
    void fixedPlayKeepsInstructionTransformAndSharesSlotOrdering() {
        var queue = new VfxActionQueue();
        var snapshot = new VfxActionQueue.Transform(12, 64, -7, 135, -20);
        assertTrue(queue.playFixed(SOURCE, "yesstevevfx:demo", "main", snapshot));
        assertTrue(queue.set(SOURCE, "main", "scale", 2, ignored -> false));
        assertTrue(queue.stop(SOURCE, "main", ignored -> false));
        assertFalse(queue.set(SOURCE, "main", "scale", 1, ignored -> false));
        assertTrue(queue.play(SOURCE, "yesstevevfx:demo", "main"));
        var actions = queue.drain();
        var fixed = ((VfxActionQueue.Play) actions.get(0)).snapshot();
        assertEquals(snapshot, fixed);
        assertEquals(12, fixed.x());
        assertEquals(64, fixed.y());
        assertEquals(-7, fixed.z());
        assertEquals(135, fixed.yaw());
        assertEquals(-20, fixed.pitch());
        assertEquals(null, ((VfxActionQueue.Play) actions.get(3)).snapshot());
    }

    @Test
    void fixedPlayIsBoundedAndClearedOnWorldOrResourceReset() {
        var queue = new VfxActionQueue();
        var snapshot = new VfxActionQueue.Transform(0, 0, 0, 0, 0);
        assertFalse(queue.playFixed(SOURCE, "yesstevevfx:demo", "main", null));
        for (int i = 0; i < 1024; i++) assertTrue(queue.playFixed(SOURCE, "yesstevevfx:demo", "main", snapshot));
        assertFalse(queue.playFixed(SOURCE, "yesstevevfx:demo", "main", snapshot));
        queue.clear();
        assertTrue(queue.drain().isEmpty());
        assertFalse(queue.stop(SOURCE, "main", ignored -> false));
    }

    @Test
    void preservesInstructionOrderAndProjectedSlotState() {
        var queue = new VfxActionQueue();
        assertTrue(queue.play(SOURCE, "yesstevevfx:demo", "main"));
        assertTrue(queue.set(SOURCE, "main", "scale", 1.25, ignored -> false));
        assertTrue(queue.stop(SOURCE, "main", ignored -> false));

        var actions = queue.drain();
        assertEquals(3, actions.size());
        assertTrue(actions.get(0) instanceof VfxActionQueue.Play);
        assertTrue(actions.get(1) instanceof VfxActionQueue.SetParameter);
        assertTrue(actions.get(2) instanceof VfxActionQueue.Stop);
        assertEquals(0, queue.size());
    }

    @Test
    void rejectsParameterInjectionAndStoppedProjectedSlots() {
        var queue = new VfxActionQueue();
        assertFalse(queue.play(SOURCE, "yesstevevfx:demo", ""));
        assertTrue(queue.play(SOURCE, "yesstevevfx:demo", "main"));
        assertFalse(queue.set(SOURCE, "main", "scale;set", 1, ignored -> false));
        assertTrue(queue.stop(SOURCE, "main", ignored -> false));
        assertFalse(queue.stop(SOURCE, "main", ignored -> false));
    }
}
