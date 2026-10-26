import { useState } from 'react';

export function FilePicker({
  id,
  accept,
  disabled,
  onFile,
  'aria-describedby': describedBy,
}: {
  id?: string;
  accept: string;
  disabled: boolean;
  onFile: (file: File) => void;
  'aria-describedby'?: string | undefined;
}) {
  const [name, setName] = useState('No file selected');
  return (
    <div className={`file-picker ${disabled ? 'is-disabled' : ''}`}>
      <input
        id={id}
        aria-describedby={describedBy}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            setName(file.name);
            onFile(file);
          }
          event.target.value = '';
        }}
      />
      <span className="file-picker-button" aria-hidden="true">
        Choose file
      </span>
      <span className="file-picker-name" aria-live="polite">
        {name}
      </span>
    </div>
  );
}
