#============================================================================================================================================
# 📦 Projects/Project-Zero/Makefile — Celestial Port Build (lens flare + clouds)
#============================================================================================================================================
#
#    The upstream Frontier- Makefile links the whole engine (Vulkan exchange, physics, audio, the editor host).
#    This repository vendors only the celestial slice of Project Zero, so the object list is reduced to exactly
#    the translation units the sky needs:
#
#        DeviceExchange/OrientationClassifier   Vector3 / Quaternion algebra the whole port is written in
#        DeviceExchange/InputExchange           the fly-through solver's input surface
#        DeviceExchange/DiagnosticMetrics       the telemetry sink the stage reports through
#        GeometricRaster/CameraProjection       ConstructRay(), the camera basis the flare reads
#
#    Everything under Source/ is byte-for-byte the reference implementation from
#    sultanaladin/Frontier- @ arena/01a09644-frontier. Do not hand-edit those files: the lens flare and the
#    cloud systems are a transcription of the published celestial console and are meant to stay one.
#
#============================================================================================================================================

CXX      := g++
CXXFLAGS := -std=c++20 -O3 -Wall -Wextra -pedantic -DFRONTIER_DEVELOPMENT -pthread
INCLUDES := -I../.. -I.
LDFLAGS  := -pthread

ENGINE_DIR := ../..

GAME_SRCS := $(wildcard Source/*.cpp)
GAME_OBJS := $(GAME_SRCS:.cpp=.o)

ENGINE_SRCS := \
	$(ENGINE_DIR)/DeviceExchange/OrientationClassifier.cpp \
	$(ENGINE_DIR)/DeviceExchange/InputExchange.cpp \
	$(ENGINE_DIR)/DeviceExchange/DiagnosticMetrics.cpp \
	$(ENGINE_DIR)/GeometricRaster/CameraProjection.cpp

ENGINE_OBJS := $(ENGINE_SRCS:.cpp=.o)

TARGET := bin/Project-Zero

.PHONY: all clean run

all: $(TARGET)

$(TARGET): $(ENGINE_OBJS) $(GAME_OBJS)
	@mkdir -p bin
	$(CXX) $(CXXFLAGS) $(INCLUDES) -o $@ $^ $(LDFLAGS)

#    -MMD -MP emits a .d sidecar listing every header each .cpp pulled in, and the include below feeds those
#    back to make. WITHOUT THIS a header-only change (adding a field to a struct, say) rebuilds nothing: the
#    stale .o files keep the OLD struct layout while the new ones use the new one, the link succeeds anyway,
#    and the program segfaults at run time on a corrupted object.
%.o: %.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) -MMD -MP -c $< -o $@

run: $(TARGET)
	cd $(dir $(TARGET)) && ./$(notdir $(TARGET))

clean:
	rm -rf $(GAME_OBJS) $(GAME_OBJS:.o=.d) $(ENGINE_OBJS) $(ENGINE_OBJS:.o=.d) bin

-include $(GAME_OBJS:.o=.d) $(ENGINE_OBJS:.o=.d)
