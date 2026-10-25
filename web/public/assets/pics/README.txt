Built-in Object-task pictures: 001.jpg … 099.jpg (shipped with the app).

In the app (preferred for lab use):
  Open Object task → edit a step → picture picker → "Add pictures".
  Uploads are saved on this device (browser / Electron) via IndexedDB and stay
  available after refresh. They are not uploaded to the GitHub Pages server.

Optional (developers only): add more built-in files here as 100.jpg, … and raise
MAX_PIC_ID in web/src/app/app.component.ts, then rebuild.
