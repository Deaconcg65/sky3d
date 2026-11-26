# The LED panels: two 64x32 panels side by side, 128 by 32 lights, showing two lines of 21 letters each.
import board
import displayio
import framebufferio
import rgbmatrix
import terminalio
from adafruit_display_text import label

WHITE = 0xffffff
GREY = 0x9aa4b0
AMBER = 0xffb000
TOP_Y, BOTTOM_Y = 8, 24
BRIGHT = 0.6     # the brightest any light gets, which keeps the panels well inside the 4 amp power supply
NIGHT = 0.25     # late at night


def soft(colour, level):
    r, g, b = (colour >> 16) & 255, (colour >> 8) & 255, colour & 255
    # lift dark airline colours so they still read on black, then scale everything down to the cap
    most = max(r, g, b, 1)
    if most < 160:
        lift = 160 / most
        r, g, b = min(255, int(r * lift)), min(255, int(g * lift)), min(255, int(b * lift))
    return (int(r * level) << 16) | (int(g * level) << 8) | int(b * level)


class Screen:
    def __init__(self, width=128, height=32):
        displayio.release_displays()
        matrix = rgbmatrix.RGBMatrix(
            width=width, height=height, bit_depth=4,
            rgb_pins=[board.MTX_R1, board.MTX_G1, board.MTX_B1, board.MTX_R2, board.MTX_G2, board.MTX_B2],
            addr_pins=[board.MTX_ADDRA, board.MTX_ADDRB, board.MTX_ADDRC, board.MTX_ADDRD],
            clock_pin=board.MTX_CLK, latch_pin=board.MTX_LAT, output_enable_pin=board.MTX_OE)
        self.display = framebufferio.FramebufferDisplay(matrix, auto_refresh=True)
        group = displayio.Group()
        self.top = label.Label(terminalio.FONT, text=' ', color=WHITE, anchor_point=(0, 0.5),
                               anchored_position=(1, TOP_Y))
        self.bottom = label.Label(terminalio.FONT, text=' ', color=GREY, anchor_point=(0, 0.5),
                                  anchored_position=(1, BOTTOM_Y))
        group.append(self.top)
        group.append(self.bottom)
        self.display.root_group = group
        self.level = BRIGHT
        self.shown = None

    def night(self, on):
        self.level = NIGHT if on else BRIGHT

    def show(self, top, bottom, top_colour=WHITE, bottom_colour=GREY):
        want = (top or ' ', bottom or ' ', soft(top_colour, self.level), soft(bottom_colour, self.level))
        if want == self.shown:
            return
        self.shown = want
        self.top.text, self.bottom.text = want[0][:21], want[1][:21]
        self.top.color, self.bottom.color = want[2], want[3]
