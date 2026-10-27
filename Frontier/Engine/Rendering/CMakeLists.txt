cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierPathReplay LANGUAGES CXX)
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
