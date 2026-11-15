import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import pretty_midi
from scipy.spatial import cKDTree

CO_COLORS_RGB = [
    (255, 255, 230),
    (253, 200, 80),
    (240, 120, 30),
    (220, 30, 20),
    (110, 0, 10),
]
CO_COLOR_POSITIONS = [0.0, 0.304, 0.533, 0.760, 1.0]
CO_CONCENTRATIONS = [40, 100, 130, 200, 500]
co_range = (40, 500)

NDVI_COLORS_RGB = [
    (150, 150, 150),
    (160, 100, 40),
    (230, 130, 20),
    (255, 220, 0),
    (130, 240, 0),
    (0, 200, 0),
]
NDVI_COLOR_POSITIONS = [0.0, 0.2, 0.35, 0.5, 0.7, 1.0]
NDVI_VALUES = [-0.1, 0.0, 0.2, 0.4, 0.6, 1.0]
ndvi_range = (-0.1, 1.0)

TEMP_COLORS_RGB = [
    (50, 90, 255),
    (50, 185, 175),
    (50, 210, 120),
    (60, 255, 70),
    (250, 255, 30),
    (255, 140, 20),
    (255, 0, 0),
]
TEMP_COLOR_POSITIONS = [0.0, 0.15, 0.31, 0.50, 0.74, 0.88, 1.0]
TEMP_VALUES = [0, 4.8, 10, 16, 23.7, 28.2, 32]
temp_range = (0, 32)

AEROSOL_NAMES = ["Black Carbon", "Dust", "Sea Salt", "Sulfate"]
AEROSOL_COLORS_RGB = [
    (210, 94, 69),
    (193, 154, 219),
    (134, 170, 170),
    (83, 220, 52),
]
AEROSOL_NOTES = [65, 60, 72, 67]
AEROSOL_PROGRAMS = [48, 11, 10, 89]

AEROSOL_MIN_BRIGHTNESS = 70
AEROSOL_MIN_SATURATION = 0.15
AEROSOL_MAX_DIST = 0.18
AEROSOL_FULL_COVERAGE = 30.0
AEROSOL_IMAGE_SECONDS = 12.0
AEROSOL_MIN_SHARE = 8.0

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"

SAMPLE_RATE = 44100
SAMPLE_EVERY = 5

MIN_PITCH = 36
MAX_PITCH = 84

MELODY_PROGRAM = 11
BASE_VELOCITY = 45
MAX_VELOCITY = 110

MAX_COLOR_DISTANCE = 60

SCALE = [0, 2, 4, 7, 9]  # major pentatonic

WORK_WIDTH = 2048
BACKGROUND_FRAMES = 12
DIFF_THRESHOLD = 40
MAX_POINTS = 60
MAX_CLICKS = 10
SEED = 7


def open_video(video):
    cap = cv2.VideoCapture(video)

    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video}")

    return cap


def is_image(path):
    return Path(path).suffix.lower() in IMAGE_EXTENSIONS


def read_first_frame(path):
    if is_image(path):
        image = cv2.imread(str(path))
        if image is None:
            raise RuntimeError(f"Cannot read image: {path}")
        return image

    cap = open_video(path)
    success, first = cap.read()
    cap.release()

    if not success:
        raise RuntimeError("Could not read the first video frame.")

    return first


def choose_region(video):
    first = read_first_frame(video)

    h, w = first.shape[:2]
    scale = min(1.0, 1280 / w)
    small = cv2.resize(first, (int(w * scale), int(h * scale)))

    x, y, rw, rh = cv2.selectROI(
        "Select region, then press Enter",
        small,
        showCrosshair=True,
        fromCenter=False
    )
    cv2.destroyAllWindows()

    if rw == 0 or rh == 0:
        return None

    return (int(x / scale), int(y / scale), int(rw / scale), int(rh / scale))


def apply_region(frame, region):
    if region is None:
        return frame

    x, y, w, h = region
    return frame[y:y + h, x:x + w]


def snap_to_scale(pitch, scale=SCALE):
    octave, note = divmod(int(pitch), 12)
    nearest = min(scale + [12], key=lambda s: abs(s - note))
    return octave * 12 + nearest


def midi_to_wav(midi_path, output="sound.wav", sf2=SF2, sample_rate=SAMPLE_RATE):
    if not Path(sf2).is_file():
        raise FileNotFoundError(f"SoundFont not found: {sf2}")

    fluidsynth = shutil.which("fluidsynth")
    if fluidsynth is None:
        raise FileNotFoundError(
            "fluidsynth not found. Install it or add it to your PATH."
        )

    subprocess.run([
        fluidsynth,
        "-ni",
        "-g", "0.35",
        "-o", "synth.reverb.level=0.8",
        "-o", "synth.reverb.room-size=0.8",
        "-r", str(sample_rate),
        sf2,
        midi_path,
        "-F", output
    ], check=True)

    return output


def smooth_values(values, window=5):
    values = np.asarray(values, dtype=float)

    if len(values) < window:
        return values

    padding = window // 2
    padded = np.pad(values, padding, mode="edge")
    kernel = np.ones(window) / window

    return np.convolve(padded, kernel, mode="valid")


def build_color_tree(color_positions, colors_rgb):
    positions = np.array(color_positions)
    colors = np.array(colors_rgb, dtype=float)

    palette_positions = np.linspace(0, 1, 256)

    palette = np.column_stack([
        np.interp(palette_positions, positions, colors[:, channel])
        for channel in range(3)
    ])

    return cKDTree(palette)


def video_to_color_scale(
    video,
    color_positions,
    colors_rgb,
    scale_values,
    region=None,
    every_n=SAMPLE_EVERY,
    max_dist=MAX_COLOR_DISTANCE
):
    cap = open_video(video)

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30

    tree = build_color_tree(color_positions, colors_rgb)

    times = []
    values = []
    frame_number = 0

    while True:
        success, frame = cap.read()
        if not success:
            break

        if frame_number % every_n == 0:
            frame = apply_region(frame, region)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pixels = rgb.reshape(-1, 3)

            distances, indices = tree.query(pixels)
            valid = distances < max_dist

            if np.any(valid):
                positions = indices[valid] / 255.0
                measured = np.interp(positions, color_positions, scale_values)
                values.append(np.median(measured))
            else:
                values.append(np.nan)

            times.append(frame_number / fps)

        frame_number += 1

    cap.release()

    if not values or np.all(np.isnan(values)):
        raise RuntimeError(
            "No valid measurements found. Check the region and colour legend."
        )

    values = np.array(values, dtype=float)
    times = np.array(times, dtype=float)

    valid_indices = np.isfinite(values)
    values = np.interp(
        np.arange(len(values)),
        np.flatnonzero(valid_indices),
        values[valid_indices]
    )

    return times, smooth_values(values)


def video_to_co(video, region=None):
    return video_to_color_scale(
        video, CO_COLOR_POSITIONS, CO_COLORS_RGB, CO_CONCENTRATIONS,
        region=region
    )


def video_to_ndvi(video, region=None):
    return video_to_color_scale(
        video, NDVI_COLOR_POSITIONS, NDVI_COLORS_RGB, NDVI_VALUES,
        region=region
    )


def video_to_temperature(video, region=None):
    return video_to_color_scale(
        video, TEMP_COLOR_POSITIONS, TEMP_COLORS_RGB, TEMP_VALUES,
        region=region
    )


def normalize_measurements(values, value_range=None):
    values = np.asarray(values, dtype=float)

    if value_range is None:
        minimum = np.min(values)
        maximum = np.max(values)
    else:
        minimum, maximum = value_range

    if maximum <= minimum:
        return np.full(len(values), 0.5)

    normalized = (values - minimum) / (maximum - minimum)

    return np.clip(normalized, 0, 1)


def measurements_to_pitches(values):
    normalized = np.clip(np.asarray(values, dtype=float), 0, 1)

    pitches = MIN_PITCH + normalized * (MAX_PITCH - MIN_PITCH)
    pitches = np.round(pitches).astype(int)

    return np.array([snap_to_scale(p) for p in pitches])


def calculate_change(values):
    values = np.asarray(values, dtype=float)

    if len(values) < 2:
        return np.zeros(len(values))

    changes = np.abs(np.diff(values))
    changes = np.append(changes, changes[-1])

    reference = np.percentile(changes, 90)

    if reference <= 0:
        return np.zeros(len(values))

    return np.clip(changes / reference, 0, 1)


def create_melody(times, values, instrument_program=MELODY_PROGRAM):
    instrument = pretty_midi.Instrument(program=instrument_program)

    pitches = measurements_to_pitches(values)
    changes = calculate_change(values)

    if len(times) == 1:
        intervals = np.array([0.2])
    else:
        intervals = np.diff(times)
        intervals = np.append(intervals, intervals[-1])

    for i, pitch in enumerate(pitches):
        interval = max(intervals[i], 0.05)

        duration_factor = 1.5 - 0.8 * changes[i]
        duration = interval * duration_factor

        velocity = int(
            BASE_VELOCITY
            + changes[i] * (MAX_VELOCITY - BASE_VELOCITY)
        )

        start = float(times[i])
        end = start + duration

        instrument.notes.append(
            pretty_midi.Note(
                velocity=velocity,
                pitch=int(pitch),
                start=start,
                end=end
            )
        )

    return instrument


def generate_sound(
    video,
    extraction_function,
    value_range=(40, 500),
    output="sound.wav",
    midi_path="sonification.mid",
    region=None,
    instrument_program=MELODY_PROGRAM,
    sf2=SF2,
    sample_rate=SAMPLE_RATE
):
    times, values = extraction_function(video, region=region)

    normalized_values = normalize_measurements(
        values,
        value_range=value_range
    )

    instrument = create_melody(
        times,
        normalized_values,
        instrument_program=instrument_program
    )

    midi = pretty_midi.PrettyMIDI()
    midi.instruments.append(instrument)
    midi.write(midi_path)

    midi_to_wav(midi_path, output, sf2, sample_rate)

    print(f"Sound generated: {output}")
    print(f"MIDI generated: {midi_path}")

    return times, values

def prepare_frame(frame, region=None):
    frame = apply_region(frame, region)

    h, w = frame.shape[:2]
    if w > WORK_WIDTH:
        frame = cv2.resize(
            frame,
            (WORK_WIDTH, int(h * WORK_WIDTH / w)),
            interpolation=cv2.INTER_AREA
        )

    return frame


def rebuild_background(video, region):
    cap = open_video(video)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    images = []

    for k in range(BACKGROUND_FRAMES):
        if total > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int((k + 0.5) * total / BACKGROUND_FRAMES))

        success, frame = cap.read()
        if success:
            images.append(prepare_frame(frame, region))

    cap.release()

    if len(images) < 3:
        raise RuntimeError("Not enough frames to rebuild the background.")

    return np.median(np.stack(images), axis=0).astype(np.uint8)


def video_to_lightning(video, region=None, every_n=10, debug_path="debug_lightning.png"):
    background = rebuild_background(video, region)
    rng = np.random.default_rng(SEED)

    cap = open_video(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

    times, densities, points = [], [], []
    best = (-1.0, None, None)
    frame_number = 0

    while True:
        if not cap.grab():  # grab = advance without decoding (faster)
            break

        if frame_number % every_n == 0:
            success, frame = cap.retrieve()
            if not success:
                break

            f = prepare_frame(frame, region)
            mask = cv2.absdiff(f, background).max(axis=2) > DIFF_THRESHOLD
            density = float(mask.mean())

            ys, xs = np.nonzero(mask)
            if len(xs) > MAX_POINTS:
                choice = rng.choice(len(xs), MAX_POINTS, replace=False)
                ys, xs = ys[choice], xs[choice]
            pts = np.column_stack([xs / mask.shape[1], ys / mask.shape[0]])

            times.append(frame_number / fps)
            densities.append(density)
            points.append(pts)

            if density > best[0]:
                best = (density, f.copy(), mask.copy())

        frame_number += 1

    cap.release()

    if len(times) < 2:
        raise RuntimeError("Video too short.")

    # Control image: pixels counted as lightning are painted red
    _, f, mask = best
    big_mask = cv2.dilate(mask.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    control = f.copy()
    control[big_mask] = (0, 0, 255)
    cv2.imwrite(debug_path, control)

    densities = np.array(densities)
    print(f"{len(times)} measurements | mean density {100 * densities.mean():.3f} % "
          f"| max {100 * densities.max():.3f} %")
    print(f"Control image: {debug_path} (detected lightning is red)")

    return np.array(times), densities, points

def lightning_to_midi(times, densities, points, midi_path="lightning.mid", position=False):
    rng = np.random.default_rng(SEED)

    root = np.sqrt(densities)
    low, high = np.percentile(root, 5), np.percentile(root, 95)
    v = np.clip((root - low) / (high - low + 1e-9), 0, 1)

    pm = pretty_midi.PrettyMIDI()
    clicks = pretty_midi.Instrument(program=115)
    rumble = pretty_midi.Instrument(program=116)
    cymbal = pretty_midi.Instrument(program=0, is_drum=True)

    intervals = np.diff(times)
    last_dt = float(intervals[-1]) if len(intervals) else 0.3
    intervals = np.append(intervals, last_dt)
    fixed_pitches = [72, 76, 79, 84, 88]

    total_clicks = 0
    for i, t0 in enumerate(times):
        t0 = float(t0)
        dt = float(intervals[i])

        if densities[i] <= 0:
            continue

        rumble.notes.append(
            pretty_midi.Note(
                int(20 + 70 * v[i]),
                36 + int(12 * v[i]),
                t0,
                t0 + dt * 1.2
            )
        )

        n = max(1, int(round(v[i] * MAX_CLICKS)))
        offsets = np.sort(rng.uniform(0, dt, n))

        for d in offsets:
            vel = int(np.clip(35 + 85 * v[i] + rng.integers(-10, 10), 1, 127))

            if position and len(points[i]) > 0:
                x, y = points[i][rng.integers(len(points[i]))]
                pitch = int(round(96 - 36 * y))    # north = high, south = low
                pan = int(np.clip(x, 0, 1) * 127)  # west = left, east = right
                clicks.control_changes.append(
                    pretty_midi.ControlChange(10, pan, max(0.0, t0 + float(d) - 0.001))
                )
            else:
                pitch = int(rng.choice(fixed_pitches))

            start = t0 + float(d)
            clicks.notes.append(pretty_midi.Note(vel, pitch, start, start + 0.08))
            total_clicks += 1

        # Activity peaks: cymbal hit
        neighbours = v[max(0, i - 2):i + 3]
        if v[i] > 0.9 and v[i] >= neighbours.max():
            cymbal.notes.append(pretty_midi.Note(100, 49, t0, t0 + 0.5))

    pm.instruments.extend([rumble, clicks, cymbal])
    pm.write(midi_path)

    print(f"MIDI written: {midi_path} ({total_clicks} clicks, {len(cymbal.notes)} peaks)")

    return midi_path


def generate_lightning_sound(
    video,
    region=None,
    output="lightning_sonification.wav",
    midi_path="lightning_sonification.mid",
    position=False,
    every_n=10
):
    times, densities, points = video_to_lightning(video, region, every_n)

    lightning_to_midi(times, densities, points, midi_path, position=position)
    midi_to_wav(midi_path, output)

    print(f"Sound generated: {output}")

    return times, densities


def analyze_aerosols(frame, region=None):

    frame = apply_region(frame, region)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pixels = rgb[::2, ::2].reshape(-1, 3).astype(float)

    legend = np.array(AEROSOL_COLORS_RGB, dtype=float)
    legend_hue = legend / legend.max(axis=1, keepdims=True)

    brightness = pixels.max(axis=1)
    saturation = (brightness - pixels.min(axis=1)) / np.maximum(brightness, 1)
    candidate = (brightness >= AEROSOL_MIN_BRIGHTNESS) & (saturation >= AEROSOL_MIN_SATURATION)

    if not np.any(candidate):
        return np.zeros(len(AEROSOL_NAMES)), 0.0

    hue = pixels[candidate] / brightness[candidate, None]
    distances = np.linalg.norm(hue[:, None, :] - legend_hue[None, :, :], axis=2)
    nearest = distances.argmin(axis=1)
    keep = distances.min(axis=1) < AEROSOL_MAX_DIST

    coverage = 100.0 * keep.sum() / len(pixels)

    if not np.any(keep):
        return np.zeros(len(AEROSOL_NAMES)), 0.0

    mass = np.bincount(
        nearest[keep],
        weights=brightness[candidate][keep],
        minlength=len(AEROSOL_NAMES)
    )

    return 100.0 * mass / mass.sum(), coverage


def media_to_aerosols(path, region=None, every_n=10):

    if is_image(path):
        frame = read_first_frame(path)
        shares, coverage = analyze_aerosols(frame, region)
        return (np.array([0.0]), [shares], np.array([coverage]),
                AEROSOL_IMAGE_SECONDS, True)

    cap = open_video(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30

    times, shares_list, coverages = [], [], []
    frame_number = 0

    while True:
        if not cap.grab():
            break

        if frame_number % every_n == 0:
            success, frame = cap.retrieve()
            if not success:
                break

            shares, coverage = analyze_aerosols(frame, region)
            times.append(frame_number / fps)
            shares_list.append(shares)
            coverages.append(coverage)

        frame_number += 1

    cap.release()

    if len(times) < 2:
        raise RuntimeError("Video too short.")

    return (np.array(times), shares_list, np.array(coverages),
            float(np.median(np.diff(times))), False)


def aerosols_to_midi(times, shares_list, coverages, slot, is_still,
                     midi_path="aerosol_sonification.mid"):
    """One voice per aerosol, all playing together.
    - share of an aerosol  -> how loud and (for a still) how many hits
    - total coverage       -> overall volume; almost no aerosol = silence
    """
    pm = pretty_midi.PrettyMIDI(initial_tempo=100)
    voices = [pretty_midi.Instrument(program=p) for p in AEROSOL_PROGRAMS]

    max_hits = 16 if is_still else 1
    intervals = np.diff(times)
    intervals = np.append(intervals, intervals[-1] if len(intervals) else slot)

    for i, t0 in enumerate(times):
        dt = float(slot if is_still else intervals[i])
        presence = float(np.clip(coverages[i] / AEROSOL_FULL_COVERAGE, 0, 1))

        if coverages[i] < 1.0:
            continue  # almost no aerosol: silence

        for k, share in enumerate(shares_list[i]):
            if share < AEROSOL_MIN_SHARE:
                continue

            hits = max(1, int(round(share / 100.0 * max_hits)))
            spacing = dt / hits
            velocity = int(np.clip(35 + 80 * (share / 100.0) * (0.4 + 0.6 * presence), 1, 127))

            for h in range(hits):
                start = float(t0) + h * spacing
                voices[k].notes.append(
                    pretty_midi.Note(velocity, AEROSOL_NOTES[k], start,
                                     start + spacing * 0.8)
                )

    for voice in voices:
        if voice.notes:
            pm.instruments.append(voice)

    if not pm.instruments:
        raise RuntimeError("No aerosol detected: check the region and legend colours.")

    pm.write(midi_path)
    print(f"MIDI written: {midi_path}")

    return midi_path


def generate_aerosol_sound(
    media,
    region=None,
    output="aerosol_sonification.wav",
    midi_path="aerosol_sonification.mid",
    every_n=10
):
    times, shares_list, coverages, slot, is_still = media_to_aerosols(
        media, region, every_n
    )

    average = np.mean(shares_list, axis=0)
    print("\nAerosol composition (average)")
    print("-----------------------------")
    for name, share in zip(AEROSOL_NAMES, average):
        print(f"{name:13s} {share:6.2f} %")
    print(f"Coverage: {np.mean(coverages):.1f} % of the area contains aerosol")

    aerosols_to_midi(times, shares_list, coverages, slot, is_still, midi_path)
    midi_to_wav(midi_path, output)

    print(f"Sound generated: {output}")

    return times, shares_list


if __name__ == "__main__":
    folder = "/home/binda77a/Desktop/NASAAPP/resources/"

    print("Which sonification?  ndvi / co / temp / lightning / aerosol")
    mode = input("Mode: ").strip().lower()

    use_region = input("Draw a region? (y/n): ").strip().lower() == "y"

    if mode == "ndvi":
        video = folder + "video3.webm"
        region = choose_region(video) if use_region else None
        generate_sound(
            video=video,
            extraction_function=video_to_ndvi,
            value_range=ndvi_range,
            region=region,
            output="output/veg_sonification.wav",
            midi_path="output/veg_sonification.mid"
        )

    elif mode == "co":
        video = folder + "video2.webm"
        region = choose_region(video) if use_region else None
        generate_sound(
            video=video,
            extraction_function=video_to_co,
            value_range=co_range,
            region=region,
            output="output/co_sonification.wav",
            midi_path="output/co_sonification.mid"
        )

    elif mode == "temp":
        video = folder + "video1.webm"
        region = choose_region(video) if use_region else None
        generate_sound(
            video=video,
            extraction_function=video_to_temperature,
            value_range=temp_range,
            region=region,
            output="output/temp_sonification.wav",
            midi_path="output/temp_sonification.mid"
        )

    elif mode == "lightning":
        video = folder + "lightning.mp4"
        region = choose_region(video) if use_region else None
        use_position = input("Use position? (y/n): ").strip().lower() == "y"
        generate_lightning_sound(
            video=video,
            region=region,
            output="output/lightning_sonification.wav",
            midi_path="loutput/ightning_sonification.mid",
            position=use_position
        )

    elif mode == "aerosol":
        media = folder + "aerosol.jpeg"
        region = choose_region(media) if use_region else None
        generate_aerosol_sound(
            media=media,
            region=region,
            output="output/aerosol_sonification.wav",
            midi_path="output/aerosol_sonification.mid"
        )

    else:
        print(f"Unknown mode: {mode}")