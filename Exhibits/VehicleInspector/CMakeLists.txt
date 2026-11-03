cmake_minimum_required(VERSION 3.20)
project(VehicleInspector LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
get_filename_component(Root "../.." ABSOLUTE)

add_executable(VehicleInspectorValidation
    Code/VehicleInspectorValidation.cpp
    "${Root}/Frontier/Engine/Scene/RecordStore.cpp"
    "${Root}/Frontier/Engine/Scene/RecordEntry.cpp"
    "${Root}/Frontier/Engine/Scene/SceneDirectory.cpp"
    "${Root}/Frontier/Engine/Scene/VehicleRecords.cpp"
    "${Root}/Frontier/Engine/Physics/ProjectDrive/Drivetrain.cpp"
    "${Root}/Frontier/Engine/Interface/SceneDirectoryPanel.cpp"
    "${Root}/Frontier/Engine/Diagnostics/LogRingStore.cpp"
    "${Root}/Frontier/Engine/Diagnostics/LogCategories.cpp"
    "${Root}/Frontier/Engine/Diagnostics/LogStream.cpp")
target_include_directories(VehicleInspectorValidation PRIVATE "${Root}/Frontier" "${Root}")
target_compile_definitions(VehicleInspectorValidation PRIVATE FRONTIER_EDITOR_PROFILE=1)
find_package(Threads REQUIRED)
target_link_libraries(VehicleInspectorValidation PRIVATE Threads::Threads)
if(NOT MSVC)
    target_compile_options(VehicleInspectorValidation PRIVATE -Wall -Wextra -Werror)
endif()
enable_testing()
add_test(NAME VehicleInspectorValidation COMMAND VehicleInspectorValidation "${CMAKE_CURRENT_BINARY_DIR}/VehicleStage.ppm")
