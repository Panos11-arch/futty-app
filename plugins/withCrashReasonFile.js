const { IOSConfig, withInfoPlist } = require('@expo/config-plugins');
const { withBuildSourceFile } = IOSConfig.XcodeProjectFile;

// TEMPORARY diagnostic. Third attempt at capturing the real reason behind
// the iOS 26 launch crash (facebook/react-native#54859):
//   1. NSSetUncaughtExceptionHandler — installed, caught nothing. Wrong
//      hook: this crash unwinds via __cxa_rethrow -> std::terminate, which
//      does not go through Foundation's top-level ObjC exception handler.
//   2. Sentry SDK — proven end-to-end working in debug (real device, real
//      DSN, event appears in dashboard), but captures nothing in Release.
//      Root cause: the app crashes ~1s into EVERY launch, so there is never
//      a safe window for Sentry's async upload of a *previous* crash report
//      to complete either — every subsequent launch is equally doomed.
// This attempt fixes both problems: std::set_terminate is the correct hook
// (fires for any uncaught exception reaching std::terminate, however it
// unwound — confirmed by reading RCTTurboModule.mm, the crash path is a
// plain @throw re-thrown as a C++ exception), and it writes synchronously
// to a local file rather than uploading anything — no network, no race
// against the next crash. UIFileSharingEnabled makes that file retrievable
// from the iOS Files app without needing the app to survive at all.
const HANDLER_CODE = `
#import <exception>
#import <Foundation/Foundation.h>

static void diagWriteCrashReason(NSString *text) {
  NSArray *paths = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
  if (paths.count == 0) return;
  NSString *path = [paths[0] stringByAppendingPathComponent:@"diag-crash-reason.txt"];
  [text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
}

static void diagTerminateHandler() {
  NSMutableString *text = [NSMutableString stringWithString:@"std::terminate reached\\n"];
  std::exception_ptr eptr = std::current_exception();
  if (eptr) {
    try {
      std::rethrow_exception(eptr);
    } catch (NSException *exc) {
      [text appendFormat:@"NSException name: %@\\nreason: %@\\nuserInfo: %@\\ncallStackSymbols:\\n%@",
        exc.name, exc.reason, exc.userInfo, [exc.callStackSymbols componentsJoinedByString:@"\\n"]];
    } catch (const std::exception &e) {
      [text appendFormat:@"std::exception: %s", e.what()];
    } catch (...) {
      [text appendString:@"unknown exception type"];
    }
  } else {
    [text appendString:@"std::current_exception() was null"];
  }
  diagWriteCrashReason(text);
}

__attribute__((constructor))
static void diagInstallTerminateHandler(void) {
  std::set_terminate(diagTerminateHandler);
}
`;

module.exports = function withCrashReasonFile(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIFileSharingEnabled = true;
    config.modResults.LSSupportsOpeningDocumentsInPlace = true;
    return config;
  });

  return withBuildSourceFile(config, {
    filePath: 'DiagCrashReasonLogger.mm',
    contents: HANDLER_CODE,
    overwrite: true,
  });
};
