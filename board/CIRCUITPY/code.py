# skypuppy3d LED flight board. This file only starts the board's program, sky/app.py, and restarts the board if that
# program ever stops with an error. Updates never change this file or boot.py, so a broken update cannot stop the
# board for good: boot.py puts the earlier version back after three starts that did not run for ten minutes.
import time

import microcontroller

try:
    import sky.app   # noqa: F401  (runs the board; it never returns)
except Exception as e:   # anything at all, including a broken update: wait a little, then start again
    print('sky.app stopped:', repr(e))
    time.sleep(15)
    microcontroller.reset()
