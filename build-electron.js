const { exec } = require('child_process');
const path = require('path');

const files = ['main.ts', 'preload.ts'];

files.forEach(file => {
  const command = `tsc electron/${file} --outDir dist/electron --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck`;
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error compiling ${file}:`, error);
      return;
    }
    if (stderr) {
      console.error(`stderr for ${file}:`, stderr);
      return;
    }
    console.log(`✓ Compiled ${file}`);
  });
});
