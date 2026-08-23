// Prevent a console window from opening alongside the app on Windows release
// builds. No effect on macOS, but harmless and keeps the crate portable.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tripplet_computer_lib::run()
}
