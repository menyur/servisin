import 'dart:async';

import 'package:flutter/services.dart';

class FlutterAppBadger {
  static const MethodChannel _channel =
      MethodChannel('g123k/flutter_app_badger');

  static Future<void> updateBadgeCount(int count) {
    return _channel.invokeMethod('updateBadgeCount', {"count": count});
  }

  static Future<void> removeBadge() {
    return _channel.invokeMethod('removeBadge');
  }

  static Future<bool> isAppBadgeSupported() async {
    final appBadgeSupported =
        await _channel.invokeMethod('isAppBadgeSupported');
    return appBadgeSupported ?? false;
  }
}
