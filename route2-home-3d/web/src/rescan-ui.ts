import { prepareRescanFiles } from './hometwin/rescanInput';

export function openRescanPicker(onFiles: (files: File[]) => void): () => void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm,video/quicktime,video/x-m4v';
  input.multiple = true;
  input.style.display = 'none';
  document.body.append(input);
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    const result = prepareRescanFiles(files);
    input.remove();
    if (result) onFiles(files);
  });
  input.click();
  return () => input.remove();
}
