package com.elfmcys.ysmvfx.client;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VfxActionQueueTest {
    private static final UUID SOURCE = UUID.randomUUID();

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
