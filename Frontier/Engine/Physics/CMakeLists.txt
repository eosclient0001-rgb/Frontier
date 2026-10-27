cmake_minimum_required(VERSION 3.20)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
    project(FrontierTyreContinuum LANGUAGES CXX)
endif()

# 📝 Standalone visual projection and Hex8 deformation; no vehicle dynamics or Jolt dependency.
add_library(FrontierTyreContinuum STATIC TyreContinuum.cpp)
target_compile_features(FrontierTyreContinuum PUBLIC cxx_std_17)
target_include_directories(FrontierTyreContinuum PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/../..")
if(MSVC)
    target_compile_options(FrontierTyreContinuum PRIVATE /utf-8 /W4)
else()
    target_compile_options(FrontierTyreContinuum PRIVATE -Wall -Wextra -Werror)
endif()
