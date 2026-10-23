cmake_minimum_required(VERSION 3.20)
project(FrontierVehiclePhysicsExhibit CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

get_filename_component(FRONTIER_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

#----------------------------------------------------------------------------------------------------------------------
#                                                        Tyre backends
#----------------------------------------------------------------------------------------------------------------------
add_library(FrontierTyreModels STATIC
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Tyre/TyreModelFactory.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Tyre/Jolt/RigidTyreModel.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Tyre/Xpbd/XpbdSpringTyreModel.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Tyre/Xpbd/XPBDSoftTyre.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Tyre/Fem/FemTyreModel.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/PacejkaMagicFormula.cpp)
target_include_directories(FrontierTyreModels PUBLIC
    ${FRONTIER_ROOT}
    ${FRONTIER_ROOT}/Engine
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle)

#----------------------------------------------------------------------------------------------------------------------
#                                        engine-agnostic vehicle stack (no Jolt)
#----------------------------------------------------------------------------------------------------------------------
set(FRONTIER_NATIVE_VEHICLE_SOURCES
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/Aerodynamics.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/Drivetrain.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/PacejkaMagicFormula.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/TyreSlipDynamics.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/VehicleGeometry.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/VehicleSolver.cpp)

add_executable(PortedVehicleValidation VehicleValidation.cpp ${FRONTIER_NATIVE_VEHICLE_SOURCES})
target_include_directories(PortedVehicleValidation PRIVATE
    ${FRONTIER_ROOT} ${FRONTIER_ROOT}/Engine ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle)

add_executable(PortedVehicleSceneValidation VehicleSceneValidation.cpp ${FRONTIER_NATIVE_VEHICLE_SOURCES})
target_include_directories(PortedVehicleSceneValidation PRIVATE
    ${FRONTIER_ROOT} ${FRONTIER_ROOT}/Engine ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle)

#----------------------------------------------------------------------------------------------------------------------
#                                                   three-backend tyre proof
#----------------------------------------------------------------------------------------------------------------------
add_executable(TyreModelValidation TyreModelValidation.cpp)
target_link_libraries(TyreModelValidation PRIVATE FrontierTyreModels)

#----------------------------------------------------------------------------------------------------------------------
#                                            Jolt-backed targets (require ExternalPackages/JoltPhysics)
#----------------------------------------------------------------------------------------------------------------------
set(FRONTIER_JOLT_VEHICLE_SOURCES
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/RigidBodySolver.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/JoltVehicleBinding.cpp
    ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle/VehiclePhysicsComponent.cpp)

if(EXISTS "${FRONTIER_ROOT}/ExternalPackages/JoltPhysics/Build/CMakeLists.txt")
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
    set(INTERPROCEDURAL_OPTIMIZATION OFF CACHE BOOL "" FORCE)
    set(OVERRIDE_CXX_FLAGS OFF CACHE BOOL "" FORCE)
    set(DEBUG_RENDERER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
    set(PROFILER_IN_DEBUG_AND_RELEASE OFF CACHE BOOL "" FORCE)
    add_subdirectory(${FRONTIER_ROOT}/ExternalPackages/JoltPhysics/Build
                     ${CMAKE_CURRENT_BINARY_DIR}/JoltPhysics EXCLUDE_FROM_ALL)

    foreach(TARGET_NAME JoltPhysicsValidation JoltVehicleBindingValidation VehiclePhysicsComponentValidation)
        add_executable(${TARGET_NAME} ${TARGET_NAME}.cpp
            ${FRONTIER_NATIVE_VEHICLE_SOURCES} ${FRONTIER_JOLT_VEHICLE_SOURCES})
        target_include_directories(${TARGET_NAME} PRIVATE
            ${FRONTIER_ROOT} ${FRONTIER_ROOT}/Engine ${FRONTIER_ROOT}/Engine/PhysicalDynamics/Vehicle)
        target_link_libraries(${TARGET_NAME} PRIVATE Jolt FrontierTyreModels)
    endforeach()
else()
    message(STATUS "ExternalPackages/JoltPhysics absent — Jolt targets skipped "
                   "(run python Automation/PrepareJolt.py in the full project to restore it)")
endif()

enable_testing()
add_test(NAME PortedVehicleValidation      COMMAND PortedVehicleValidation)
add_test(NAME PortedVehicleSceneValidation COMMAND PortedVehicleSceneValidation)
add_test(NAME TyreModelValidation          COMMAND TyreModelValidation)
