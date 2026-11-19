# ============================================================================================================================================
#                                                            CMAKELISTS.TXT
# ============================================================================================================================================
# 🧩 Isolated Slang cloud translation, native integration, reproducible noise and optional Vulkan bytecode; no production editor changes.

cmake_minimum_required(VERSION 3.20)
project(FrontierPlanetaryClouds LANGUAGES CXX)
get_filename_component(FrontierDirectory "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
find_package(Threads REQUIRED)
find_package(Python3 COMPONENTS Interpreter REQUIRED)
find_program(FRONTIER_CLOUD_SLANG slangc HINTS
    "${FrontierDirectory}/ExternalPackages/VulkanCompute/Slang/slangtorch/bin" REQUIRED)
set(FRONTIER_CLOUD_OPTIMIZER "" CACHE FILEPATH "Optional pinned spirv-opt executable")
set(FRONTIER_CLOUD_VALIDATOR "" CACHE FILEPATH "Optional pinned spirv-val executable")
file(GLOB CloudShaders CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.slang")

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${CloudShaders}
    "${CMAKE_CURRENT_SOURCE_DIR}/CloudNative.cpp" "${CMAKE_CURRENT_SOURCE_DIR}/CloudNoiseVolume.h"
    "${FrontierDirectory}/Exhibits/PlanetaryClouds/Code/BakeCloudNoise.cpp"
    "${FrontierDirectory}/Exhibits/PlanetaryClouds/Code/CloudSourceIdentity.py")
execute_process(COMMAND "${Python3_EXECUTABLE}"
    "${FrontierDirectory}/Exhibits/PlanetaryClouds/Code/CloudSourceIdentity.py"
    OUTPUT_VARIABLE CloudSourceSha256 OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)

# ------------------------------------------------------------------------------------------------------------------------
#                                                       NATIVE SLANG TARGET
# ------------------------------------------------------------------------------------------------------------------------

set(GeneratedCloud "${CMAKE_CURRENT_BINARY_DIR}/CloudGenerated.cpp")
add_custom_command(OUTPUT "${GeneratedCloud}"
    COMMAND "${FRONTIER_CLOUD_SLANG}" "${CMAKE_CURRENT_SOURCE_DIR}/CloudCompute.slang"
        -entry CloudCaptureEntry -target cpp -fp-mode precise -O0 -o "${GeneratedCloud}"
    DEPENDS ${CloudShaders} VERBATIM)
set_source_files_properties("${GeneratedCloud}" PROPERTIES HEADER_FILE_ONLY TRUE)
add_library(CloudNative SHARED CloudNative.cpp "${GeneratedCloud}")
target_compile_features(CloudNative PRIVATE cxx_std_20)
target_compile_definitions(CloudNative PRIVATE FRONTIER_CLOUD_SOURCE_SHA256="${CloudSourceSha256}")
target_include_directories(CloudNative PRIVATE "${FrontierDirectory}" "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(CloudNative PRIVATE Threads::Threads)
set_target_properties(CloudNative PROPERTIES PREFIX "" WINDOWS_EXPORT_ALL_SYMBOLS TRUE)
if(MSVC)
    target_compile_options(CloudNative PRIVATE /W4 /utf-8 /fp:strict /bigobj)
else()
    target_compile_options(CloudNative PRIVATE -fno-fast-math -ffp-contract=off -fno-math-errno)
endif()

add_executable(CloudNoiseBake "${FrontierDirectory}/Exhibits/PlanetaryClouds/Code/BakeCloudNoise.cpp")
target_compile_features(CloudNoiseBake PRIVATE cxx_std_20)
target_include_directories(CloudNoiseBake PRIVATE "${FrontierDirectory}")
if(MSVC)
    target_compile_options(CloudNoiseBake PRIVATE /utf-8)
endif()
set(CloudNoise "${CMAKE_CURRENT_BINARY_DIR}/CloudNoise.volume")
add_custom_command(OUTPUT "${CloudNoise}"
    COMMAND CloudNoiseBake "${CloudNoise}" DEPENDS CloudNoiseBake CloudNoiseVolume.h VERBATIM)
add_custom_target(CloudNoiseVolume ALL DEPENDS "${CloudNoise}")

option(FRONTIER_CLOUD_SANITIZERS "Instrument native cloud execution and noise synthesis with address/undefined checks" OFF)
if(FRONTIER_CLOUD_SANITIZERS)
    if(MSVC)
        message(FATAL_ERROR "This exhibit's combined address/undefined instrumentation requires Clang or GCC")
    endif()
    foreach(CloudTarget CloudNative CloudNoiseBake)
        target_compile_options(${CloudTarget} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
        target_link_options(${CloudTarget} PRIVATE -fsanitize=address,undefined)
    endforeach()
endif()

include(CTest)
add_test(NAME CloudVolumeBehavior COMMAND "${Python3_EXECUTABLE}"
    "${FrontierDirectory}/Exhibits/PlanetaryClouds/Code/ValidateClouds.py"
    --library "$<TARGET_FILE:CloudNative>" --noise "${CloudNoise}"
    --out "${CMAKE_CURRENT_BINARY_DIR}/Validation")

# ------------------------------------------------------------------------------------------------------------------------
#                                                    OPTIONAL VULKAN BYTECODE
# ------------------------------------------------------------------------------------------------------------------------

option(FRONTIER_CLOUD_VULKAN "Translate the full cloud image entry to SPIR-V" ON)
if(FRONTIER_CLOUD_VULKAN)
    set(RawShader "${CMAKE_CURRENT_BINARY_DIR}/CloudCapture.Raw.spv")
    add_custom_command(OUTPUT "${RawShader}" "${RawShader}.json"
        COMMAND "${FRONTIER_CLOUD_SLANG}" "${CMAKE_CURRENT_SOURCE_DIR}/CloudCompute.slang"
            -entry CloudCaptureEntry -target spirv -profile spirv_1_3 -fp-mode precise -fvk-use-entrypoint-name
            -D FRONTIER_CLOUD_BEAUTY_ONLY=1 -D FRONTIER_CLOUD_TEXTURES=1 -O0 -o "${RawShader}" -reflection-json "${RawShader}.json"
        DEPENDS ${CloudShaders} VERBATIM)
    if(FRONTIER_CLOUD_OPTIMIZER)
        set(FinalShader "${CMAKE_CURRENT_BINARY_DIR}/CloudCapture.spv")
        add_custom_command(OUTPUT "${FinalShader}"
            COMMAND "${FRONTIER_CLOUD_OPTIMIZER}" -O --preserve-bindings "${RawShader}" -o "${FinalShader}"
            DEPENDS "${RawShader}" VERBATIM)
        if(FRONTIER_CLOUD_VALIDATOR)
            add_custom_command(OUTPUT "${FinalShader}.Validated"
                COMMAND "${FRONTIER_CLOUD_VALIDATOR}" --target-env vulkan1.1 "${FinalShader}"
                COMMAND "${CMAKE_COMMAND}" -E touch "${FinalShader}.Validated"
                DEPENDS "${FinalShader}" VERBATIM)
            add_custom_target(CloudVulkanShaders ALL DEPENDS "${FinalShader}.Validated")
        else()
            add_custom_target(CloudVulkanShaders ALL DEPENDS "${FinalShader}")
        endif()
    else()
        add_custom_target(CloudVulkanShaders ALL DEPENDS "${RawShader}" "${RawShader}.json")
    endif()
endif()
