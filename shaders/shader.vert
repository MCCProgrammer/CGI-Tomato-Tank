#version 300 es

in vec4 a_position; 
in vec3 a_normal; 

uniform mat4 u_model_view;
uniform mat4 u_projection;

void main() {
    gl_Position = u_projection * u_model_view * a_position;
}