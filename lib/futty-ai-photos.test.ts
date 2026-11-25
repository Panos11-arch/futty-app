// S13A: photos for Futty AI: camera or library, up to the room left in the
// message, each resized on the phone to a 1600 px JPEG with its base64.
import { pickAiPhotos } from '@/lib/futty-ai-photos';

const mockLibrary = jest.fn();
const mockCamera = jest.fn();
const mockCameraPermission = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...a: unknown[]) => mockLibrary(...a),
  launchCameraAsync: (...a: unknown[]) => mockCamera(...a),
  requestCameraPermissionsAsync: () => mockCameraPermission(),
}));

const mockResize = jest.fn();
const mockSave = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      const context = {
        resize: (size: unknown) => {
          mockResize(uri, size);
          return context;
        },
        renderAsync: () => Promise.resolve({ width: 4000, height: 3000, saveAsync: (o: unknown) => mockSave(uri, o) }),
      };
      return context;
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockImplementation((uri: string) => Promise.resolve({ uri: `${uri}.jpg`, base64: `b64-${uri}` }));
  mockCameraPermission.mockResolvedValue({ granted: true });
});

it('library: several photos, up to the room left, each a resized JPEG with base64', async () => {
  mockLibrary.mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'wide', width: 4000, height: 3000 },
      { uri: 'tall', width: 1000, height: 3000 },
      { uri: 'small', width: 800, height: 600 },
    ],
  });
  expect(await pickAiPhotos('library', 2)).toEqual([
    { uri: 'wide.jpg', base64: 'b64-wide' },
    { uri: 'tall.jpg', base64: 'b64-tall' },
  ]);
  expect(mockLibrary).toHaveBeenCalledWith(
    expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 2 })
  );
  expect(mockResize).toHaveBeenCalledWith('wide', { width: 1600 });
  expect(mockResize).toHaveBeenCalledWith('tall', { height: 1600 });
  expect(mockSave).toHaveBeenCalledWith('wide', { format: 'jpeg', compress: 0.7, base64: true });
});

it('a small photo is never enlarged', async () => {
  mockLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: 'small', width: 800, height: 600 }] });
  await pickAiPhotos('library', 3);
  expect(mockResize).not.toHaveBeenCalled();
});

it('camera: asks for the camera first', async () => {
  mockCamera.mockResolvedValue({ canceled: false, assets: [{ uri: 'shot', width: 3000, height: 4000 }] });
  expect(await pickAiPhotos('camera', 3)).toEqual([{ uri: 'shot.jpg', base64: 'b64-shot' }]);
  expect(mockCameraPermission).toHaveBeenCalled();
});

it('camera refused: "denied", no camera', async () => {
  mockCameraPermission.mockResolvedValue({ granted: false });
  expect(await pickAiPhotos('camera', 3)).toBe('denied');
  expect(mockCamera).not.toHaveBeenCalled();
});

it('cancelled, or no room left: nothing', async () => {
  mockLibrary.mockResolvedValue({ canceled: true, assets: null });
  expect(await pickAiPhotos('library', 3)).toEqual([]);
  expect(await pickAiPhotos('library', 0)).toEqual([]);
  expect(mockLibrary).toHaveBeenCalledTimes(1);
});
