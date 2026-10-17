import 'package:flutter_test/flutter_test.dart';

import 'package:fixify_app/models.dart';

/// Aturan "data profil teknisi belum lengkap" — dipakai untuk mengarahkan
/// tampilan awal ke Profil dan menyalakan pengingat. Murni, tanpa perangkat,
/// supaya batasannya tidak tersebar di beberapa layar.
Profile _profil({
  String role = 'technician',
  String name = 'Andi Teknisi',
  String? phone = '081234567890',
  String? address = 'Jl. Mawar 1',
  String? serviceArea = 'Bandung',
}) =>
    Profile(
      id: 'u-1',
      name: name,
      email: 'andi@example.com',
      role: role,
      phone: phone,
      address: address,
      serviceArea: serviceArea,
    );

void main() {
  group('dataProfilKurang', () {
    test('teknisi baru: area layanan adalah satu-satunya yang kurang', () {
      // Pendaftaran sudah mengisi nama/HP/alamat, tetapi service_area tidak
      // pernah dikirim saat signup — inilah yang memicu pengingat.
      final kurang = dataProfilKurang(_profil(serviceArea: null));

      expect(kurang, ['area layanan']);
    });

    test('teknisi lengkap: tidak ada yang dilaporkan', () {
      expect(dataProfilKurang(_profil()), isEmpty);
    });

    test('pelanggan tidak pernah diminta melengkapi profil teknisi', () {
      final pelanggan = _profil(
        role: 'customer',
        phone: null,
        address: null,
        serviceArea: null,
      );

      expect(dataProfilKurang(pelanggan), isEmpty);
      expect(dataProfilKurang(null), isEmpty);
    });

    test('urutan label tetap: nama, HP, alamat, area layanan', () {
      final kurang = dataProfilKurang(_profil(
        name: '  ',
        phone: '',
        address: '   ',
        serviceArea: null,
      ));

      expect(kurang, ['nama lengkap', 'nomor HP', 'alamat', 'area layanan']);
    });

    test('spasi saja dianggap kosong', () {
      final kurang = dataProfilKurang(
          _profil(phone: '   ', address: ' ', serviceArea: '  '));

      expect(kurang, ['nomor HP', 'alamat', 'area layanan']);
    });
  });
}
