# flutter_app_badger (salinan lokal)

Ini salinan **flutter_app_badger 1.5.0** (Apache-2.0) yang dipakai lewat
`path:` di `pubspec.yaml`.

Alasannya: paket asli sudah *discontinued* dan `android/build.gradle`-nya belum
memiliki `namespace`, sehingga build Flutter dengan AGP 9 gagal:

```
Namespace not specified. Specify a namespace in the module's build file
```

Patch di sini hanya menyentuh build Android (namespace, compileSdk 36, Java 17)
dan menghapus buildscript AGP 4.1.0 milik paket. API Dart tetap sama.

Catatan perilaku: di Android, badge launcher bergantung pada dukungan
launcher/ShortcutBadger. `isAppBadgeSupported()` bisa bernilai `false` pada
perangkat yang tidak mendukung; badge di dalam aplikasi tetap berfungsi.
