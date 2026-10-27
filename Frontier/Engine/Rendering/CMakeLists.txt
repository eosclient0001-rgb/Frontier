cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierPathReplay LANGUAGES CXX)
endif()

# 📝 Typed shader inputs do not provide Vulkan submission or editor integration.
add_library(FrontierMediumRadiancePayload STATIC MediumRadiancePayload.cpp)
target_compile_features(FrontierMediumRadiancePayload PUBLIC cxx_std_17)
target_include_directories(FrontierMediumRadiancePayload PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierMediumRadiancePayload PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierMediumRadiancePayload PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Float32 source distribution is shared by surface and fog transport; submission remains separate.
add_library(FrontierRadiantFacetDistribution STATIC RadiantFacetDistribution.cpp)
target_compile_features(FrontierRadiantFacetDistribution PUBLIC cxx_std_17)
target_include_directories(FrontierRadiantFacetDistribution PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierRadiantFacetDistribution PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierRadiantFacetDistribution PRIVATE -Wall -Wextra -Werror)
endif()

# 📝 Reusable bounded replay-domain intake; shader submission and editor wiring are separate work.
add_library(FrontierPathReplayDomain STATIC PathReplayDomain.cpp)
target_compile_features(FrontierPathReplayDomain PUBLIC cxx_std_20)
target_include_directories(FrontierPathReplayDomain PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierPathReplayDomain PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierPathReplayDomain PRIVATE -Wall -Wextra -Werror)
endif()
