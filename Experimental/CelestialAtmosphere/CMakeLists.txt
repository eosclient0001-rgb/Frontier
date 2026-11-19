# ============================================================================================================================================
#                                                            CMAKELISTS.TXT
# ============================================================================================================================================
# 🧩 Isolated celestial Slang/Vulkan execution and native physics validation; does not change the production editor.

cmake_minimum_required(VERSION 3.20)
project(FrontierCelestialAtmosphere LANGUAGES CXX)
get_filename_component(FrontierDirectory "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
find_package(Threads REQUIRED)
set(FRONTIER_CELESTIAL_INPUTS "" CACHE PATH "Prepared Moon PPM and Milky Way scalar field")
set(FRONTIER_CELESTIAL_DRIVER "" CACHE FILEPATH "Explicit Vulkan driver shared library")
set(CelestialSources "${FrontierDirectory}/Frontier/Engine/Rendering/CelestialModel.cpp"
                     "${FrontierDirectory}/Frontier/Engine/Rendering/AtmosphereModel.cpp")

function(ConfigureCelestial Target)
    target_compile_features(${Target} PRIVATE cxx_std_20)
    target_include_directories(${Target} PRIVATE "${FrontierDirectory}" "${FrontierDirectory}/Frontier")
    target_link_libraries(${Target} PRIVATE Threads::Threads)
    if(MSVC)
        target_compile_options(${Target} PRIVATE /W4 /utf-8 /fp:strict)
    else()
        target_compile_options(${Target} PRIVATE -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off)
    endif()
endfunction()

add_executable(CelestialValidation "${FrontierDirectory}/Exhibits/CelestialAtmosphere/Code/CelestialValidation.cpp" ${CelestialSources})
ConfigureCelestial(CelestialValidation)
add_executable(CelestialCatalogueProbe "${FrontierDirectory}/Exhibits/NightSky/Code/StarCatalogueProbe.cpp"
    "${FrontierDirectory}/Frontier/Engine/Rendering/CelestialModel.cpp")
ConfigureCelestial(CelestialCatalogueProbe)
include(CTest)
if(FRONTIER_CELESTIAL_INPUTS)
    add_test(NAME CelestialNativePhysics COMMAND CelestialValidation "${FRONTIER_CELESTIAL_INPUTS}"
        "${FrontierDirectory}/Exhibits/NightSky/Data/Hipparcos8.csv" "${CMAKE_CURRENT_BINARY_DIR}/Numeric")
endif()

# ------------------------------------------------------------------------------------------------------------------------
#                                                    EXECUTABLE SLANG / VULKAN
# ------------------------------------------------------------------------------------------------------------------------

option(FRONTIER_CELESTIAL_VULKAN "Build real celestial Slang/Vulkan readback" ON)
if(FRONTIER_CELESTIAL_VULKAN)
    find_package(Vulkan REQUIRED)
    find_program(FRONTIER_CELESTIAL_SLANG slangc REQUIRED)
    add_executable(CelestialVulkan "${FrontierDirectory}/Exhibits/CelestialAtmosphere/Code/CelestialVulkan.cpp" ${CelestialSources})
    ConfigureCelestial(CelestialVulkan)
    target_link_libraries(CelestialVulkan PRIVATE Vulkan::Vulkan ${CMAKE_DL_LIBS})
    if(NOT MSVC)
        target_compile_options(CelestialVulkan PRIVATE -Wno-missing-field-initializers)
    endif()
    file(GLOB CelestialShaders CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.slang")
    set(ShaderOutputs)
    foreach(Entry BakeAtmosphereTransmittance BakeAtmosphereMultiple ResolveSolarVisibility ResolveAtmosphericSolarFlux
                  ResolveCataloguePhotometry RenderCelestialAtmosphere RenderLunarSurface RenderSolarAtmosphere
                  RenderLensFlare InspectCelestialPhysics)
        set(Output "${CMAKE_CURRENT_BINARY_DIR}/Shaders/${Entry}.spv")
        add_custom_command(OUTPUT "${Output}" "${Output}.json"
            COMMAND "${CMAKE_COMMAND}" -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/Shaders"
            COMMAND "${FRONTIER_CELESTIAL_SLANG}" "${CMAKE_CURRENT_SOURCE_DIR}/CelestialAtmosphere.slang"
                -entry "${Entry}" -target spirv -profile glsl_450 -fp-mode precise -O0 -o "${Output}"
                -reflection-json "${Output}.json"
            DEPENDS ${CelestialShaders} "${FrontierDirectory}/Frontier/Engine/Rendering/Shaders/SolarOptics.slang" VERBATIM)
        list(APPEND ShaderOutputs "${Output}" "${Output}.json")
    endforeach()
    add_custom_target(CelestialShaders ALL DEPENDS ${ShaderOutputs})
    add_dependencies(CelestialVulkan CelestialShaders)
    if(FRONTIER_CELESTIAL_INPUTS AND FRONTIER_CELESTIAL_DRIVER)
        add_test(NAME CelestialShaderReadback COMMAND CelestialVulkan "${CMAKE_CURRENT_BINARY_DIR}/Shaders"
            "${FRONTIER_CELESTIAL_INPUTS}" "${FrontierDirectory}/Exhibits/NightSky/Data/Hipparcos8.csv"
            "${CMAKE_CURRENT_BINARY_DIR}/Vulkan" "${FRONTIER_CELESTIAL_DRIVER}" validate)
    endif()
endif()
