import Foundation
import XCTest

final class RunnerTests: XCTestCase {
  func testApplicationDoesNotOptOutOfTransportSecurity() {
    let security = Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") as? [String: Any]
    XCTAssertNotEqual(security?["NSAllowsArbitraryLoads"] as? Bool, true)
  }

  func testApplicationRegistersFlutterSceneDelegate() throws {
    let manifest = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") as? [String: Any])
    let configurations = try XCTUnwrap(manifest["UISceneConfigurations"] as? [String: Any])
    let scenes = try XCTUnwrap(configurations["UIWindowSceneSessionRoleApplication"] as? [[String: Any]])
    let delegate = try XCTUnwrap(scenes.first?["UISceneDelegateClassName"] as? String)
    XCTAssertTrue(delegate.hasSuffix(".SceneDelegate"))
    XCTAssertEqual(manifest["UIApplicationSupportsMultipleScenes"] as? Bool, false)
  }
}
